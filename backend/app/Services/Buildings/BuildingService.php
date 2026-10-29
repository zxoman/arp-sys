<?php

namespace App\Services\Buildings;

use App\Models\Building;
use App\Models\BuildingActivity;
use App\Models\Floor;
use App\Enums\AuditAction;
use App\Enums\BuildingActivity as BuildingActivityEnum;
use App\Enums\BuildingType;
use App\Services\Audit\AuditLogger;
use App\Support\Transactions\Operation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class BuildingService
{
    private const FLOOR_DISPLAY_NAMES = [
        0 => 'بدروم',
        1 => 'الأول',
        2 => 'الثاني',
        3 => 'الثالث',
        4 => 'الرابع',
        5 => 'الخامس',
        6 => 'السادس',
        7 => 'السابع',
        8 => 'الثامن',
        9 => 'التاسع',
        10 => 'العاشر',
    ];

    public function __construct(
        private Operation $operation,
        private AuditLogger $audit
    ) {
    }

    public function create(array $data, $actor): Building
    {
        return DB::transaction(function () use ($data, $actor) {
            $building = Building::create([
                'name' => $data['name'],
                'number' => $data['number'] ?? null,
                'type' => $data['type'],
                'area' => $data['area'] ?? null,
                'floors_count' => $data['floors_count'] ?? 0,
                'units_per_floor' => $data['units_per_floor'] ?? null,
                'total_units' => $data['total_units'] ?? 0,
                'has_basement' => $data['has_basement'] ?? false,
                'city' => $data['city'] ?? null,
                'district' => $data['district'] ?? null,
            ]);

            // Save activities
            $activities = $data['activities'] ?? [];
            $this->saveActivities($building, $activities, $actor);

            // Auto-generate floors
            $this->generateFloors($building, $actor);

            $this->audit->log(
                action: AuditAction::CREATE->value,
                entityType: 'buildings',
                entityId: $building->id,
                newValues: $this->safeBuildingArray($building),
                reason: 'Building created by ' . $actor->name,
            );

            return $building->load('activities', 'floors');
        });
    }

    public function update(Building $building, array $data, $actor): Building
    {
        return DB::transaction(function () use ($building, $data, $actor) {
            $oldValues = $this->safeBuildingArray($building);

            // Handle activity changes
            if (isset($data['activities'])) {
                $this->updateActivities($building, $data['activities'], $actor);
            }

            // Handle floors_count changes
            if (isset($data['floors_count'])) {
                $this->updateFloorsCount($building, (int) $data['floors_count'], $actor);
            }

            // Handle has_basement changes
            if (isset($data['has_basement'])) {
                $this->updateHasBasement($building, (bool) $data['has_basement'], $actor);
            }

            // Update other fields
            $building->update(array_filter([
                'name' => $data['name'] ?? $building->name,
                'number' => $data['number'] ?? $building->number,
                'type' => $data['type'] ?? $building->type,
                'area' => $data['area'] ?? $building->area,
                'units_per_floor' => $data['units_per_floor'] ?? $building->units_per_floor,
                'total_units' => $data['total_units'] ?? $building->total_units,
                'city' => $data['city'] ?? $building->city,
                'district' => $data['district'] ?? $building->district,
            ]));

            $this->audit->log(
                action: AuditAction::UPDATE->value,
                entityType: 'buildings',
                entityId: $building->id,
                oldValues: $oldValues,
                newValues: $this->safeBuildingArray($building->fresh()),
                changedFields: array_keys(array_filter([
                    'name' => $data['name'] ?? null,
                    'number' => $data['number'] ?? null,
                    'type' => $data['type'] ?? null,
                    'area' => $data['area'] ?? null,
                    'units_per_floor' => $data['units_per_floor'] ?? null,
                    'city' => $data['city'] ?? null,
                    'district' => $data['district'] ?? null,
                ])),
                reason: 'Building updated by ' . $actor->name,
            );

            return $building->fresh()->load('activities', 'floors');
        });
    }

    public function delete(Building $building, $actor): void
    {
        if ($building->hasUnits()) {
            $this->audit->logRejected(
action: AuditAction::DELETE->value,
                reason: 'Cannot delete building with units',
                entityType: 'buildings',
                entityId: $building->id,
            );

            throw ValidationException::withMessages([
                'buildings' => __('buildings.cannot_delete_with_units'),
            ]);
        }

        $oldValues = $this->safeBuildingArray($building);
        $building->delete();

        $this->audit->log(
            action: AuditAction::REJECTED_OPERATION->value,
            entityType: 'buildings',
            entityId: $building->id,
            oldValues: $oldValues,
            reason: 'Building deleted by ' . $actor->name,
        );
    }

    /**
     * Get autocomplete suggestions for city/district.
     */
    public function getSuggestions(string $type, ?string $city = null, ?string $query = null): array
    {
        $queryBuilder = Building::query()
            ->whereNotNull($type)
            ->where($type, '!=', '')
            ->distinct();

        if ($type === 'district' && $city) {
            $queryBuilder->where('city', $city);
        }

        if ($query) {
            $normalizedQuery = \App\Support\Text\ArabicNormalizer::normalize($query);
            // MySQL/MariaDB: we'll fetch and normalize in PHP for simplicity
            $rows = $queryBuilder->get()->map(function ($row) use ($type, $normalizedQuery) {
                $value = $row->$type;
                $normalized = \App\Support\Text\ArabicNormalizer::normalize($value);
                return [
                    'value' => $value,
                    'normalized' => $normalized,
                    'matches' => str_contains($normalized, $normalizedQuery),
                ];
            })->filter(fn ($r) => $r['matches'])->map(fn ($r) => $r['value'])->values()->all();
        } else {
            $rows = $queryBuilder->pluck($type)->all();
        }

        return array_values(array_unique($rows));
    }

    private function saveActivities(Building $building, array $activities, $actor): void
    {
        if (empty($activities)) {
            throw ValidationException::withMessages([
                'activities' => __('buildings.at_least_one_activity'),
            ]);
        }

        $validActivities = BuildingActivityEnum::allValues();
        $invalid = array_diff($activities, $validActivities);
        if (!empty($invalid)) {
            throw ValidationException::withMessages([
                'activities' => __('buildings.invalid_activities', ['activities' => implode(', ', $invalid)]),
            ]);
        }

        foreach ($activities as $activity) {
            BuildingActivity::create([
                'building_id' => $building->id,
                'activity' => $activity,
            ]);
        }

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'buildings',
            entityId: $building->id,
            newValues: ['activities' => $activities],
            isAutomatic: true,
            reason: 'Activities set during building creation',
        );
    }

    private function updateActivities(Building $building, array $newActivities, $actor): void
    {
        $currentActivities = $building->activities()->pluck('activity')->all();

        // Check: last remaining activity cannot be removed
        $activitiesToRemove = array_diff($currentActivities, $newActivities);
        foreach ($activitiesToRemove as $activity) {
            // Check if units use this activity
            $unitsUsing = $building->units()->where('activity', $activity)->count();
            if ($unitsUsing > 0) {
                throw ValidationException::withMessages([
                    'activities' => __('buildings.cannot_remove_activity_in_use', ['activity' => $activity]),
                ]);
            }
        }

        // Check: cannot remove last activity
        $remainingCount = count(array_diff($currentActivities, $activitiesToRemove));
        if ($remainingCount === 0 && !empty($currentActivities)) {
            throw ValidationException::withMessages([
                'activities' => __('buildings.cannot_remove_last_activity'),
            ]);
        }

        // Remove activities
        $building->activities()->whereIn('activity', $activitiesToRemove)->delete();

        // Add new activities
        $activitiesToAdd = array_diff($newActivities, $currentActivities);
        foreach ($activitiesToAdd as $activity) {
            BuildingActivity::create([
                'building_id' => $building->id,
                'activity' => $activity,
            ]);
        }

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'buildings',
            entityId: $building->id,
            oldValues: ['activities' => $currentActivities],
            newValues: ['activities' => $newActivities],
            isAutomatic: true,
            reason: 'Activities updated by ' . $actor->name,
        );
    }

    private function generateFloors(Building $building, $actor): void
    {
        if ($building->has_basement) {
            Floor::create([
                'building_id' => $building->id,
                'floor_number' => 0,
                'display_name' => $this->getFloorDisplayName(0),
                'units_count' => 0,
            ]);
        }

        for ($i = 1; $i <= $building->floors_count; $i++) {
            Floor::create([
                'building_id' => $building->id,
                'floor_number' => $i,
                'display_name' => $this->getFloorDisplayName($i),
                'units_count' => 0,
            ]);
        }

        $this->audit->log(
            action: AuditAction::CREATE->value,
            entityType: 'buildings',
            entityId: $building->id,
            newValues: ['floors_count' => $building->floors_count, 'has_basement' => $building->has_basement],
            isAutomatic: true,
            reason: 'Floors auto-generated during building creation',
        );
    }

    private function updateFloorsCount(Building $building, int $newCount, $actor): void
    {
        $currentCount = $building->floors_count;
        $hasBasement = $building->has_basement;

        // Calculate actual floor count (including basement if present)
        $actualCurrent = $hasBasement ? $currentCount + 1 : $currentCount;
        $actualNew = $hasBasement ? $newCount + 1 : $newCount;

        if ($actualNew > $actualCurrent) {
            // Adding floors
            $start = $actualCurrent + 1;
            if (!$hasBasement && $start === 1) {
                $start = 1; // First floor above ground
            }
            // If has basement, floor 0 exists, so start from 1
            if ($hasBasement && $start === 1) {
                $start = 1;
            }

            for ($i = $start; $i <= $actualNew; $i++) {
                $displayNumber = $hasBasement ? $i : $i;
                Floor::create([
                    'building_id' => $building->id,
                    'floor_number' => $displayNumber,
                    'display_name' => $this->getFloorDisplayName($displayNumber),
                    'units_count' => 0,
                ]);
            }
        } elseif ($actualNew < $actualCurrent) {
            // Removing floors - check if removed floors have units
            $removedFloors = Floor::where('building_id', $building->id)
                ->where('floor_number', '>', $actualNew)
                ->get();

            foreach ($removedFloors as $floor) {
                if ($floor->units_count > 0) {
                    throw ValidationException::withMessages([
                        'floors_count' => __('buildings.cannot_remove_floors_with_units'),
                    ]);
                }
                $floor->delete();
            }
        }

        $building->update(['floors_count' => $newCount]);

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'buildings',
            entityId: $building->id,
            oldValues: ['floors_count' => $currentCount],
            newValues: ['floors_count' => $newCount],
            isAutomatic: true,
            reason: 'Floors count updated by ' . $actor->name,
        );
    }

    private function updateHasBasement(Building $building, bool $newHasBasement, $actor): void
    {
        $currentHasBasement = $building->has_basement;

        if ($newHasBasement === $currentHasBasement) {
            return;
        }

        if ($newHasBasement) {
            // Adding basement - create floor 0
            $existingBasement = Floor::where('building_id', $building->id)
                ->where('floor_number', 0)
                ->first();

            if (!$existingBasement) {
                Floor::create([
                    'building_id' => $building->id,
                    'floor_number' => 0,
                    'display_name' => $this->getFloorDisplayName(0),
                    'units_count' => 0,
                ]);
            }
        } else {
            // Removing basement - check if floor 0 has units
            $basement = Floor::where('building_id', $building->id)
                ->where('floor_number', 0)
                ->first();

            if ($basement && $basement->units_count > 0) {
                throw ValidationException::withMessages([
                    'has_basement' => __('buildings.cannot_remove_basement_with_units'),
                ]);
            }

            if ($basement) {
                $basement->delete();
            }
        }

        $building->update(['has_basement' => $newHasBasement]);

        $this->audit->log(
            action: AuditAction::UPDATE->value,
            entityType: 'buildings',
            entityId: $building->id,
            oldValues: ['has_basement' => $currentHasBasement],
            newValues: ['has_basement' => $newHasBasement],
            isAutomatic: true,
            reason: 'Basement updated by ' . $actor->name,
        );
    }

    private function getFloorDisplayName(int $floorNumber): string
    {
        return self::FLOOR_DISPLAY_NAMES[$floorNumber] ?? 'طابق ' . $floorNumber;
    }

    private function safeBuildingArray(Building $building): array
    {
        return [
            'id' => $building->id,
            'name' => $building->name,
            'number' => $building->number,
            'type' => $building->type?->value,
            'area' => $building->area,
            'floors_count' => $building->floors_count,
            'units_per_floor' => $building->units_per_floor,
            'total_units' => $building->total_units,
            'has_basement' => $building->has_basement,
            'city' => $building->city,
            'district' => $building->district,
            'activities' => $building->activities()->pluck('activity')->all(),
        ];
    }
}

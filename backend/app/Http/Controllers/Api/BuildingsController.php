<?php

namespace App\Http\Controllers\Api;

use App\Enums\BuildingActivity;
use App\Enums\BuildingType;
use App\Http\Controllers\Controller;
use App\Http\Requests\Buildings\StoreBuildingRequest;
use App\Http\Requests\Buildings\UpdateBuildingRequest;
use App\Http\Resources\Buildings\BuildingResource;
use App\Models\Building;
use App\Services\Buildings\BuildingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class BuildingsController extends Controller
{
    public function __construct(private BuildingService $buildingService) {}

    public function index(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Building::class);

        $query = Building::query()->with('activities')->withCount('units');

        if ($type = $request->get('type')) {
            $query->where('type', $type);
        }
        if ($city = $request->get('city')) {
            $query->where('city', $city);
        }
        if ($district = $request->get('district')) {
            $query->where('district', $district);
        }
        if ($activity = $request->get('activity')) {
            $query->whereHas('activities', fn ($q) => $q->where('activity', $activity));
        }

        // Free-text search: name/number/city/district, plus the Arabic labels of the type and activity enums
        // (e.g. «برج» → tower, «سكني» → residential).
        if ($search = trim((string) $request->get('search'))) {
            $typeMatch = $this->matchBuildingType($search);
            $activityMatch = $this->matchBuildingActivity($search);

            $query->where(function ($q) use ($search, $typeMatch, $activityMatch) {
                $like = '%' . $search . '%';
                $q->where('name', 'like', $like)
                    ->orWhere('number', 'like', $like)
                    ->orWhere('city', 'like', $like)
                    ->orWhere('district', 'like', $like);

                if ($typeMatch) {
                    $q->orWhere('type', $typeMatch);
                }
                if ($activityMatch) {
                    $q->orWhereHas('activities', fn ($qq) => $qq->where('activity', $activityMatch));
                }
            });
        }

        $sortable = ['id', 'name', 'type', 'city', 'district', 'floors_count', 'total_units', 'has_basement', 'created_at'];
        $sort = (string) $request->get('sort', 'created_at');
        $query->orderBy(in_array($sort, $sortable, true) ? $sort : 'created_at', $request->get('dir') === 'asc' ? 'asc' : 'desc');

        $perPage = max(1, min((int) $request->get('per_page', 15), 100));
        $buildings = $query->paginate($perPage)->withQueryString();

        return response()->json([
            'data' => BuildingResource::collection($buildings),
            'meta' => [
                'current_page' => $buildings->currentPage(),
                'last_page' => $buildings->lastPage(),
                'per_page' => $buildings->perPage(),
                'total' => $buildings->total(),
                'from' => $buildings->firstItem(),
                'to' => $buildings->lastItem(),
            ],
        ]);
    }

    /** Maps an Arabic (or English) type label to its enum value, for free-text search. */
    private function matchBuildingType(string $search): ?string
    {
        foreach (BuildingType::cases() as $type) {
            if (Str::contains($type->label(), $search) || Str::contains(__("enums.building_type.{$type->value}", [], 'ar'), $search)) {
                return $type->value;
            }
        }

        return null;
    }

    /** Maps an Arabic (or English) activity label to its enum value, for free-text search. */
    private function matchBuildingActivity(string $search): ?string
    {
        foreach (BuildingActivity::cases() as $activity) {
            if (Str::contains($activity->label(), $search) || Str::contains(__("enums.building_activity.{$activity->value}", [], 'ar'), $search)) {
                return $activity->value;
            }
        }

        return null;
    }

    public function store(StoreBuildingRequest $request): JsonResponse
    {
        $building = $this->buildingService->create($request->validated(), $request->user());

        return response()->json([
            'data' => new BuildingResource($building),
        ], 201);
    }

    public function show(Building $building): JsonResponse
    {
        $this->authorize('view', $building);

        return response()->json([
            'data' => new BuildingResource($building->load('activities', 'floors.units')->loadCount('units')),
        ]);
    }

    public function update(UpdateBuildingRequest $request, Building $building): JsonResponse
    {
        $this->authorize('update', $building);

        $building = $this->buildingService->update($building, $request->validated(), $request->user());

        return response()->json([
            'data' => new BuildingResource($building),
        ]);
    }

    public function destroy(Building $building, Request $request): JsonResponse
    {
        $this->authorize('delete', $building);

        $this->buildingService->delete($building, $request->user());

        return response()->json([
            'data' => ['message' => __('buildings.deleted')],
        ]);
    }

    public function suggestions(Request $request): JsonResponse
    {
        $this->authorize('viewAny', Building::class);

        $type = $request->get('type', 'city'); // city or district
        $city = $request->get('city');
        $query = $request->get('query');

        $suggestions = $this->buildingService->getSuggestions($type, $city, $query);

        return response()->json([
            'data' => $suggestions,
        ]);
    }
}

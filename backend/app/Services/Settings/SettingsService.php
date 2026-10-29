<?php

namespace App\Services\Settings;

use App\Enums\AuditAction;
use App\Models\Setting;
use App\Models\User;
use App\Services\Audit\AuditLogger;
use Illuminate\Support\Facades\DB;

class SettingsService
{
    public const PROJECT_NAME = 'project_name';
    public const PROJECT_ADDRESS = 'project_address';

    /**
     * Settings exposed through the API, mapped to their storage keys.
     */
    private const EXPOSED = [
        'project_name' => self::PROJECT_NAME,
        'project_address' => self::PROJECT_ADDRESS,
    ];

    public function __construct(private AuditLogger $audit)
    {
    }

    public function all(): array
    {
        $stored = Setting::whereIn('key', array_values(self::EXPOSED))
            ->pluck('value', 'key');

        $result = [];
        foreach (self::EXPOSED as $field => $key) {
            $result[$field] = $stored[$key] ?? '';
        }

        return $result;
    }

    public function update(array $data, User $actor): array
    {
        return DB::transaction(function () use ($data, $actor) {
            $oldValues = $this->all();

            foreach (self::EXPOSED as $field => $key) {
                if (!array_key_exists($field, $data)) {
                    continue;
                }

                Setting::updateOrCreate(
                    ['key' => $key],
                    ['value' => $data[$field]],
                );
            }

            $newValues = $this->all();

            $this->audit->log(
                action: AuditAction::UPDATE->value,
                entityType: 'settings',
                entityId: null,
                oldValues: $oldValues,
                newValues: $newValues,
                reason: 'Project settings updated by ' . $actor->name,
            );

            return $newValues;
        });
    }
}

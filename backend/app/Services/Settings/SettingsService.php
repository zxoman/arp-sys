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

    public const COMPANY_NAME = 'company_name';

    public const COMPANY_ADDRESS = 'company_address';

    public const COMPANY_PHONE = 'company_phone';

    public const COMPANY_LOGO = 'company_logo';

    public const OUR_LOGO = 'our_logo';

    public const SHOW_COMPANY_LOGO = 'show_company_logo';

    public const SHOW_OUR_LOGO = 'show_our_logo';

    public const DEVELOPER_URL = 'developer_url';

    /**
     * Settings exposed through the API, mapped to their storage keys. They live in the database so
     * every browser sees the same project data (owner decision 2026-11-01).
     */
    private const EXPOSED = [
        'project_name' => self::PROJECT_NAME,
        'project_address' => self::PROJECT_ADDRESS,
        'company_name' => self::COMPANY_NAME,
        'company_address' => self::COMPANY_ADDRESS,
        'company_phone' => self::COMPANY_PHONE,
        'company_logo' => self::COMPANY_LOGO,
        'our_logo' => self::OUR_LOGO,
        'show_company_logo' => self::SHOW_COMPANY_LOGO,
        'show_our_logo' => self::SHOW_OUR_LOGO,
        'developer_url' => self::DEVELOPER_URL,
    ];

    /** Settings stored as booleans ("1"/"0") but sent as JSON booleans. */
    private const BOOLEANS = ['show_company_logo', 'show_our_logo'];

    public function __construct(private AuditLogger $audit) {}

    public function all(): array
    {
        $stored = Setting::whereIn('key', array_values(self::EXPOSED))
            ->pluck('value', 'key');

        $result = [];
        foreach (self::EXPOSED as $field => $key) {
            $value = $stored[$key] ?? '';

            if (in_array($field, self::BOOLEANS, true)) {
                // Unset means "shown", matching the app's default.
                $result[$field] = $value === '' ? true : (bool) (int) $value;

                continue;
            }

            $result[$field] = $value;
        }

        return $result;
    }

    public function update(array $data, User $actor): array
    {
        return DB::transaction(function () use ($data, $actor) {
            $oldValues = $this->all();

            foreach (self::EXPOSED as $field => $key) {
                if (! array_key_exists($field, $data)) {
                    continue;
                }

                $value = in_array($field, self::BOOLEANS, true)
                    ? ((bool) $data[$field] ? '1' : '0')
                    : ($data[$field] ?? '');

                Setting::updateOrCreate(
                    ['key' => $key],
                    ['value' => $value],
                );
            }

            $newValues = $this->all();

            $this->audit->log(
                action: AuditAction::UPDATE->value,
                entityType: 'settings',
                entityId: null,
                oldValues: $oldValues,
                newValues: $newValues,
                reason: 'Project settings updated by '.$actor->name,
            );

            return $newValues;
        });
    }
}

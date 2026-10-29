<?php

namespace App\Enums;

enum UserStatus: string
{
    case ACTIVE = 'active';
    case SUSPENDED = 'suspended';

    public function label(): string
    {
        return match ($this) {
            self::ACTIVE => __('enums.user_status.active'),
            self::SUSPENDED => __('enums.user_status.suspended'),
        };
    }
}

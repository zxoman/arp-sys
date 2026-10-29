<?php

namespace App\Enums;

enum AuditAction: string
{
    case CREATE = 'create';
    case UPDATE = 'update';
    case DELETE = 'delete';
    case RESTORE = 'restore';
    case CANCEL = 'cancel';
    case CONVERT = 'convert';
    case LOGIN = 'login';
    case LOGOUT = 'logout';
    case LOGIN_FAILED = 'login_failed';
    case EXPORT = 'export';
    case REJECTED_OPERATION = 'rejected_operation';

    public function label(): string
    {
        return __("audit.actions.{$this->value}");
    }
}

<?php

namespace App\Services\Audit;

use App\Models\AuditLog;
use App\Support\Transactions\Operation;

class AuditLogger
{
    private Operation $operation;

    public function __construct(Operation $operation)
    {
        $this->operation = $operation;
    }

    public function log(
        string $action,
        ?string $entityType = null,
        ?int $entityId = null,
        array $oldValues = [],
        array $newValues = [],
        array $changedFields = [],
        bool $isAutomatic = false,
        ?string $reason = null,
        array $meta = []
    ): void {
        AuditLog::create([
            'user_id' => auth()->id(),
            'actor_type' => auth()->id() ? 'user' : 'system',
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'old_values' => $oldValues,
            'new_values' => $newValues,
            'changed_fields' => $changedFields,
            'is_automatic' => $isAutomatic,
            'operation_id' => $this->operation->id(),
            'ip' => request()->ip(),
            'user_agent' => request()->userAgent(),
            'http_method' => request()->method(),
            'endpoint' => request()->path(),
            'reason' => $reason,
            'meta' => $meta,
            'occurred_at' => $this->operation->now(),
        ]);
    }

    public function logRejected(
        string $action,
        string $reason,
        ?string $entityType = null,
        ?int $entityId = null,
        array $meta = []
    ): void {
        // Rejected operations are logged in a separate transaction so they persist
        // even if the main operation transaction rolls back.
        \Illuminate\Support\Facades\DB::transaction(function () use ($action, $reason, $entityType, $entityId, $meta) {
            AuditLog::create([
                'user_id' => auth()->id(),
                'actor_type' => auth()->id() ? 'user' : 'system',
                'action' => $action,
                'entity_type' => $entityType,
                'entity_id' => $entityId,
                'old_values' => null,
                'new_values' => null,
                'changed_fields' => null,
                'is_automatic' => false,
                'operation_id' => $this->operation->id(),
                'ip' => request()->ip(),
                'user_agent' => request()->userAgent(),
                'http_method' => request()->method(),
                'endpoint' => request()->path(),
                'reason' => $reason,
                'meta' => $meta,
                'occurred_at' => $this->operation->now(),
            ]);
        });
    }
}

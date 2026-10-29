<?php

namespace App\Models;

use App\Enums\AuditAction;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    use HasFactory;

    protected $table = 'audit_logs';

    protected $fillable = [
        'user_id',
        'actor_type',
        'action',
        'entity_type',
        'entity_id',
        'old_values',
        'new_values',
        'changed_fields',
        'is_automatic',
        'operation_id',
        'ip',
        'user_agent',
        'http_method',
        'endpoint',
        'reason',
        'meta',
        'occurred_at',
    ];

    protected $casts = [
        'action' => AuditAction::class,
        'old_values' => 'array',
        'new_values' => 'array',
        'changed_fields' => 'array',
        'is_automatic' => 'boolean',
        'occurred_at' => 'datetime',
        'meta' => 'array',
    ];

    public $timestamps = false;

    public function user(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Override to prevent updates (append-only).
     */
    public function save(array $options = []): bool
    {
        if ($this->exists && !$this->isDirty()) {
            return true;
        }

        if ($this->exists && $this->isDirty()) {
            throw new \RuntimeException('AuditLog is append-only; updates are not allowed.');
        }

        return parent::save($options);
    }

    /**
     * Override to prevent deletes (append-only).
     */
    public function delete(): bool
    {
        throw new \RuntimeException('AuditLog is append-only; deletes are not allowed.');
    }

    public function forceDelete(): bool
    {
        throw new \RuntimeException('AuditLog is append-only; force deletes are not allowed.');
    }
}

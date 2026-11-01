<?php

namespace App\Http\Resources\Admin;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AuditLogResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'user_id' => $this->user_id,
            'user_name' => $this->whenLoaded('user', fn () => $this->user?->name),
            'actor_type' => $this->actor_type,
            'action' => $this->action?->value ?? $this->action,
            'entity_type' => $this->entity_type,
            'entity_id' => $this->entity_id,
            'old_values' => $this->old_values,
            'new_values' => $this->new_values,
            'changed_fields' => $this->changed_fields,
            'is_automatic' => $this->is_automatic,
            'operation_id' => $this->operation_id,
            'ip' => $this->ip,
            'http_method' => $this->http_method,
            'endpoint' => $this->endpoint,
            'reason' => $this->reason,
            'meta' => $this->meta,
            'occurred_at' => $this->occurred_at,
        ];
    }
}

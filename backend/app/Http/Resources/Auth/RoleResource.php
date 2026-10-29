<?php

namespace App\Http\Resources\Auth;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class RoleResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'display_name' => $this->display_name,
            'description' => $this->description,
            'is_admin' => $this->is_admin,
            'permissions' => $this->when(true, fn () => \App\Models\RolePermission::where('role_id', $this->id)->pluck('permission')),
            'created_at' => $this->created_at,
        ];
    }
}

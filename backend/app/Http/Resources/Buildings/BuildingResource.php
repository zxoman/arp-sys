<?php

namespace App\Http\Resources\Buildings;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BuildingResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'number' => $this->number,
            'type' => $this->type?->value,
            'type_label' => $this->type?->label(),
            'area' => $this->area,
            'floors_count' => $this->floors_count,
            'units_per_floor' => $this->units_per_floor,
            'total_units' => $this->total_units,
            'units_count' => $this->units_count ?? $this->units()->count(),
            'has_basement' => $this->has_basement,
            'city' => $this->city,
            'district' => $this->district,
            'activities' => $this->whenLoaded('activities', fn () => $this->activities->pluck('activity')),
            'floors' => BuildingFloorResource::collection($this->whenLoaded('floors')),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'deleted_at' => $this->deleted_at,
        ];
    }
}

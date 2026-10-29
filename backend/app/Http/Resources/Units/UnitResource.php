<?php

namespace App\Http\Resources\Units;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UnitResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'building_id' => $this->building_id,
            'building_name' => $this->whenLoaded('building', fn () => $this->building->name),
            'floor_id' => $this->floor_id,
            'floor_number' => $this->whenLoaded('floor', fn () => $this->floor->floor_number),
            'floor_display_name' => $this->whenLoaded('floor', fn () => $this->floor->display_name),
            'name' => $this->name,
            'type' => $this->type?->value,
            'type_label' => $this->type?->label(),
            'activity' => $this->activity,
            'purpose' => $this->purpose?->value,
            'purpose_label' => $this->purpose?->label(),
            'area' => $this->area,
            'price_per_meter' => $this->price_per_meter,
            'sale_price' => $this->sale_price,
            'total_price' => $this->total_price,
            'is_sellable' => (bool) $this->is_sellable,
            'non_sellable_reason' => $this->non_sellable_reason,
            'rooms' => $this->rooms,
            'bathrooms' => $this->bathrooms,
            'status' => $this->status?->value,
            'status_label' => $this->status?->label(),
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'deleted_at' => $this->deleted_at,
        ];
    }
}

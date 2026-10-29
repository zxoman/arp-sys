<?php

namespace App\Http\Resources\Buildings;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BuildingFloorResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'floor_number' => $this->floor_number,
            'display_name' => $this->display_name,
            'units_count' => $this->units_count,
        ];
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class BuildingActivity extends Model
{
    use HasFactory;

    protected $table = 'building_activities';

    protected $fillable = [
        'building_id',
        'activity',
    ];

    public $timestamps = true;

    public function building()
    {
        return $this->belongsTo(Building::class);
    }
}

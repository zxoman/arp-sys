<?php

namespace App\Models;

use App\Enums\BuildingActivity;
use App\Enums\BuildingType;
use App\Models\BuildingActivity as BuildingActivityModel;
use App\Support\Text\ArabicNormalizer;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Building extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'name',
        'number',
        'type',
        'area',
        'floors_count',
        'units_per_floor',
        'total_units',
        'has_basement',
        'city',
        'district',
    ];

    protected $casts = [
        'type' => BuildingType::class,
        'has_basement' => 'boolean',
        'floors_count' => 'integer',
        'units_per_floor' => 'integer',
        'total_units' => 'integer',
        'area' => 'decimal:2',
    ];

    public function activities(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(BuildingActivityModel::class);
    }
    public function floors(): HasMany
    {
        return $this->hasMany(Floor::class)->orderBy('floor_number');
    }

    public function units(): HasMany
    {
        return $this->hasMany(Unit::class);
    }

    public function hasUnits(): bool
    {
        return $this->units()->exists();
    }

    public function activityExists(string $activity): bool
    {
        return $this->activities()->where('activity', $activity)->exists();
    }

    public function activityCount(): int
    {
        return $this->activities()->count();
    }

    /**
     * Normalize city/district for autocomplete comparison.
     */
    public static function normalizeCity(string $city): string
    {
        return ArabicNormalizer::normalize($city);
    }

    public static function normalizeDistrict(string $district): string
    {
        return ArabicNormalizer::normalize($district);
    }
}

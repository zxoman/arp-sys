<?php

namespace App\Models;

use App\Enums\UnitPurpose;
use App\Enums\UnitStatus;
use App\Enums\UnitType;
use App\Support\Money\DecimalCast;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Unit extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'building_id',
        'floor_id',
        'name',
        'type',
        'activity',
        'purpose',
        'area',
        'price_per_meter',
        'sale_price',
        'is_sellable',
        'non_sellable_reason',
        'rooms',
        'bathrooms',
        'status',
    ];

    protected $casts = [
        'type' => UnitType::class,
        'purpose' => UnitPurpose::class,
        'status' => UnitStatus::class,
        'area' => 'decimal:2',
        'price_per_meter' => 'decimal:2',
        'sale_price' => 'decimal:2',
        'is_sellable' => 'boolean',
        'rooms' => 'integer',
        'bathrooms' => 'integer',
    ];

    public function building(): BelongsTo
    {
        return $this->belongsTo(Building::class);
    }

    public function floor(): BelongsTo
    {
        return $this->belongsTo(Floor::class);
    }

    public function reservations(): HasMany
    {
        return $this->hasMany(\App\Models\Reservation::class);
    }

    public function contracts(): HasMany
    {
        return $this->hasMany(\App\Models\Contract::class);
    }

    /**
     * Sale price = the explicit `sale_price` when set, otherwise area x price_per_meter.
     * Rent-only units have no sale price. Computed, never stored.
     */
    public function getTotalPriceAttribute(): ?string
    {
        if (!$this->offersSale()) {
            return null;
        }

        if ($this->sale_price) {
            return (string) $this->sale_price;
        }

        if (!$this->area || !$this->price_per_meter) {
            return null;
        }

        return \App\Support\Money\MoneyCalculator::multiplyAreaByPricePerMeter(
            $this->area,
            $this->price_per_meter
        );
    }

    /** The unit may be sold (purpose sale/both). */
    public function offersSale(): bool
    {
        return ($this->purpose ?? UnitPurpose::BOTH)->offersSale();
    }

    /** The unit may be rented (purpose rent/both). */
    public function offersRent(): bool
    {
        return ($this->purpose ?? UnitPurpose::BOTH)->offersRent();
    }

    /**
     * Building_id is immutable after creation.
     */
    public static function boot()
    {
        parent::boot();

        static::updating(function (Unit $unit) {
            if ($unit->isDirty('building_id')) {
                throw new \RuntimeException('building_id is immutable after creation.');
            }
        });
    }
}

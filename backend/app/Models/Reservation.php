<?php

namespace App\Models;

use App\Enums\ReservationStatus;
use App\Support\Money\DecimalCast;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Reservation extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'client_id',
        'building_id',
        'unit_id',
        'unit_type',
        'unit_activity',
        'reservation_date',
        'status',
        'cancelled_at',
        'cancellation_reason',
    ];

    protected $casts = [
        'status' => ReservationStatus::class,
        'reservation_date' => 'date',
        'cancelled_at' => 'datetime',
    ];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function building(): BelongsTo
    {
        return $this->belongsTo(Building::class);
    }

    public function unit(): BelongsTo
    {
        return $this->belongsTo(Unit::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(ReservationPayment::class);
    }

    /**
     * Computed deposit paid = sum of valid payments. A reservation has no agreed price, so there is
     * no "remaining" amount; the price is agreed at contract time.
     */
    public function getDepositPaidAttribute(): string
    {
        // Use the eager-loaded relation when the caller loaded it, to avoid one query per row.
        $amounts = $this->relationLoaded('payments')
            ? $this->payments
                ->filter(fn ($p) => $p->status?->value === 'valid' && $p->deleted_at === null)
                ->pluck('amount')
                ->all()
            : $this->payments()
                ->where('status', 'valid')
                ->whereNull('deleted_at')
                ->pluck('amount')
                ->all();

        return \App\Support\Money\MoneyCalculator::sumPayments($amounts);
    }

    public function isActive(): bool
    {
        return $this->status === ReservationStatus::ACTIVE;
    }

    public function isConverted(): bool
    {
        return $this->status === ReservationStatus::CONVERTED;
    }

    public function isCancelled(): bool
    {
        return $this->status === ReservationStatus::CANCELLED;
    }
}
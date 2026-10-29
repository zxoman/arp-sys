<?php

namespace App\Models;

use App\Enums\InstallmentStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Installment extends Model
{
    use HasFactory;

    protected $fillable = [
        'contract_id',
        'sequence_number',
        'due_date',
        'amount',
        'paid_amount',
        'remaining',
        'status',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'paid_amount' => 'decimal:2',
        'remaining' => 'decimal:2',
        'status' => InstallmentStatus::class,
        'due_date' => 'date',
        'sequence_number' => 'integer',
    ];

    public function contract(): BelongsTo
    {
        return $this->belongsTo(Contract::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(InstallmentPayment::class);
    }

    public function isPaid(): bool
    {
        return $this->status === InstallmentStatus::PAID;
    }

    public function isPartiallyPaid(): bool
    {
        return $this->status === InstallmentStatus::PARTIALLY_PAID;
    }

    public function isDue(): bool
    {
        return $this->status === InstallmentStatus::DUE;
    }

    /** Installments of a cancelled contract keep their amounts but are no longer collectable. */
    public function isCancelled(): bool
    {
        return $this->status === InstallmentStatus::CANCELLED;
    }

    /**
     * Overdue is computed at read time, never stored as a status.
     */
    public function isOverdue(\Carbon\CarbonImmutable $today = null): bool
    {
        if ($this->isCancelled()) {
            return false;
        }

        $today = $today ?? \Carbon\CarbonImmutable::now();

        return $this->due_date < $today->toDateString() && (float) $this->remaining > 0;
    }
}
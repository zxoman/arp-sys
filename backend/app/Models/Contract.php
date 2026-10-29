<?php

namespace App\Models;

use App\Enums\ContractStatus;
use App\Enums\ContractType;
use App\Support\Money\DecimalCast;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class Contract extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'number',
        'reservation_id',
        'type',
        'client_id',
        'unit_id',
        'contract_date',
        'total_price',
        'discount',
        'discount_reason',
        'agreed_down_payment',
        'installments_count',
        'first_installment_date',
        'interval_months',
        'monthly_rent',
        'duration_months',
        'start_date',
        'end_date',
        'security_deposit',
        'advance_months',
        'annual_increase_pct',
        'increase_from_year',
        'draft_schedule',
        'notes',
        'status',
        'cancelled_at',
        'cancellation_reason',
    ];

    protected $casts = [
        'type' => ContractType::class,
        'status' => ContractStatus::class,
        'total_price' => 'decimal:2',
        'discount' => 'decimal:2',
        'agreed_down_payment' => 'decimal:2',
        'installments_count' => 'integer',
        'contract_date' => 'date',
        'first_installment_date' => 'date',
        'interval_months' => 'integer',
        'monthly_rent' => 'decimal:2',
        'duration_months' => 'integer',
        'start_date' => 'date',
        'end_date' => 'date',
        'security_deposit' => 'decimal:2',
        'advance_months' => 'integer',
        'annual_increase_pct' => 'decimal:2',
        'increase_from_year' => 'integer',
        'draft_schedule' => 'array',
        'cancelled_at' => 'datetime',
    ];

    public function reservation(): BelongsTo
    {
        return $this->belongsTo(Reservation::class);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function unit(): BelongsTo
    {
        return $this->belongsTo(Unit::class);
    }

    public function installments(): HasMany
    {
        return $this->hasMany(Installment::class)->orderBy('sequence_number');
    }

    public function downPayments(): HasMany
    {
        return $this->hasMany(ContractDownPayment::class);
    }

    /** The first row of the schedule that still has a balance (the row the collection page chases). */
    public function firstOpenInstallment(): HasOne
    {
        return $this->hasOne(Installment::class)->ofMany(
            ['sequence_number' => 'min'],
            fn ($query) => $query->where('remaining', '>', 0)
        );
    }

    /** The last row that has been fully collected (partial rows are still «شغال», not «مسدد»). */
    public function lastPaidInstallment(): HasOne
    {
        return $this->hasOne(Installment::class)->ofMany(
            ['sequence_number' => 'max'],
            fn ($query) => $query->where('remaining', '<=', 0)
        );
    }

    public function installmentPayments(): HasMany
    {
        return $this->hasMany(InstallmentPayment::class);
    }

    /**
     * One reservation -> at most one contract (drafts included; a cancelled one frees it again).
     */
    public static function boot()
    {
        parent::boot();

        static::creating(function (Contract $contract) {
            if ($contract->reservation_id) {
                $existing = Contract::where('reservation_id', $contract->reservation_id)
                    ->whereIn('status', ['active', 'draft'])
                    ->exists();
                if ($existing) {
                    throw new \RuntimeException('One reservation can have at most one contract.');
                }
            }
        });

        // Financial fields are immutable once the contract is posted; a draft may still change its schedule.
        static::updating(function (Contract $contract) {
            if ($contract->getOriginal('status') === ContractStatus::DRAFT->value) {
                return;
            }

            $immutableFields = ['number', 'reservation_id', 'type', 'client_id', 'unit_id',
                'contract_date', 'total_price', 'discount', 'discount_reason', 'agreed_down_payment',
                'installments_count', 'first_installment_date', 'interval_months', 'monthly_rent',
                'duration_months', 'start_date', 'end_date', 'security_deposit', 'advance_months',
                'annual_increase_pct', 'increase_from_year'];
            $dirtyImmutable = array_intersect($contract->getDirty(), $immutableFields);
            if (!empty($dirtyImmutable)) {
                throw new \RuntimeException('Financial fields are immutable: ' . implode(', ', $dirtyImmutable));
            }
        });
    }

    public function isActive(): bool
    {
        return $this->status === ContractStatus::ACTIVE;
    }

    public function isCancelled(): bool
    {
        return $this->status === ContractStatus::CANCELLED;
    }

    public function getPaidDownPaymentAttribute(): string
    {
        $reservationPayments = $this->reservation?->deposit_paid ?? '0';
        // Use the eager-loaded relation when the caller loaded it, to avoid one query per row.
        $contractPayments = $this->relationLoaded('downPayments')
            ? $this->downPayments
                ->filter(fn ($payment) => ($payment->status?->value ?? $payment->status) === 'valid' && $payment->deleted_at === null)
                ->pluck('amount')
                ->all()
            : $this->downPayments()
                ->where('status', 'valid')
                ->whereNull('deleted_at')
                ->pluck('amount')
                ->all();

        return \App\Support\Money\MoneyCalculator::sumPayments(array_merge([$reservationPayments], $contractPayments));
    }

    public function getRemainingDownPaymentAttribute(): string
    {
        return \App\Support\Money\MoneyCalculator::remaining(
            $this->agreed_down_payment,
            $this->paid_down_payment
        );
    }

    public function getTotalCollectedAttribute(): string
    {
        $downPaymentPaid = $this->downPayments()
            ->where('status', 'valid')
            ->whereNull('deleted_at')
            ->sum('amount');
        $installmentPaid = $this->installmentPayments()
            ->where('status', 'valid')
            ->whereNull('deleted_at')
            ->sum('amount');

        return \App\Support\Money\MoneyCalculator::sumPayments([
            $downPaymentPaid,
            $installmentPaid,
        ]);
    }
}
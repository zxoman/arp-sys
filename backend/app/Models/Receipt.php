<?php

namespace App\Models;

use App\Enums\PaymentStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One collection act: a numbered receipt covering one or more installment payments and,
 * optionally, part of the contract's down payment.
 */
class Receipt extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'number',
        'contract_id',
        'paid_at',
        'payment_method',
        'reference',
        'total_amount',
        'notes',
        'status',
        'cancel_reason',
        'cancelled_at',
        'created_by',
    ];

    protected $casts = [
        'paid_at' => 'date',
        'total_amount' => 'decimal:2',
        'status' => PaymentStatus::class,
        'cancelled_at' => 'datetime',
    ];

    public function contract(): BelongsTo
    {
        return $this->belongsTo(Contract::class);
    }

    public function installmentPayments(): HasMany
    {
        return $this->hasMany(InstallmentPayment::class);
    }

    public function downPayments(): HasMany
    {
        return $this->hasMany(ContractDownPayment::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isValid(): bool
    {
        return $this->status === PaymentStatus::VALID;
    }
}

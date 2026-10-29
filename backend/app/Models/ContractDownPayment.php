<?php

namespace App\Models;

use App\Enums\PaymentStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class ContractDownPayment extends Model
{
    use HasFactory, SoftDeletes;

    protected $table = 'contract_down_payments';

    protected $fillable = [
        'contract_id',
        'receipt_id',
        'amount',
        'paid_at',
        'payment_method',
        'notes',
        'status',
        'cancel_reason',
        'cancelled_at',
        'created_by',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'paid_at' => 'date',
        'status' => PaymentStatus::class,
        'cancelled_at' => 'datetime',
    ];

    public function contract(): BelongsTo
    {
        return $this->belongsTo(Contract::class);
    }

    public function receipt(): BelongsTo
    {
        return $this->belongsTo(Receipt::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(\App\Models\User::class, 'created_by');
    }

    public function isValid(): bool
    {
        return $this->status === PaymentStatus::VALID;
    }
}
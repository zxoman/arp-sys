<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A receipt (إيصال قبض) is one collection act: one number, one date, one payment method and one
 * total, split across installment payments and — optionally — the contract's down payment.
 * The payments keep their own rows in their own tables and point back here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('receipts', function (Blueprint $table) {
            $table->id();
            $table->string('number')->unique();
            $table->foreignId('contract_id')->constrained('contracts')->restrictOnDelete();
            $table->date('paid_at');
            $table->string('payment_method')->nullable();
            $table->string('reference')->nullable(); // cheque / transfer number
            $table->decimal('total_amount', 14, 2)->unsigned();
            $table->text('notes')->nullable();
            $table->string('status')->default('valid'); // valid or cancelled
            $table->text('cancel_reason')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('contract_id');
            $table->index('status');
            $table->index('paid_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('receipts');
    }
};

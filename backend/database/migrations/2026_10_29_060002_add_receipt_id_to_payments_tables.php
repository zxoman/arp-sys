<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Every payment line of a receipt keeps its own row in its own table; `receipt_id` groups them.
 * Nullable: payments recorded before receipts existed (e.g. the down payment rows a contract may
 * be created with) have none.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('installment_payments', function (Blueprint $table) {
            $table->foreignId('receipt_id')->nullable()->after('installment_id')
                ->constrained('receipts')->nullOnDelete();
            $table->index('receipt_id');
        });

        Schema::table('contract_down_payments', function (Blueprint $table) {
            $table->foreignId('receipt_id')->nullable()->after('contract_id')
                ->constrained('receipts')->nullOnDelete();
            $table->index('receipt_id');
        });
    }

    public function down(): void
    {
        Schema::table('installment_payments', function (Blueprint $table) {
            $table->dropForeign(['receipt_id']);
            $table->dropColumn('receipt_id');
        });

        Schema::table('contract_down_payments', function (Blueprint $table) {
            $table->dropForeign(['receipt_id']);
            $table->dropColumn('receipt_id');
        });
    }
};

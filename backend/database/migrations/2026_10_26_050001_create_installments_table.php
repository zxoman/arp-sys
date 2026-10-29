<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('installments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('contract_id')->constrained('contracts')->cascadeOnDelete();
            $table->unsignedInteger('sequence_number');
            $table->date('due_date');
            $table->decimal('amount', 14, 2)->unsigned(); // fixed, never changes
            $table->decimal('paid_amount', 14, 2)->unsigned()->default(0);
            $table->decimal('remaining', 14, 2)->unsigned();
            $table->string('status')->default('due'); // due, partially_paid, paid
            $table->timestamps();

            $table->index('contract_id');
            $table->index('due_date');
            $table->index('status');
            $table->unique(['contract_id', 'sequence_number']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('installments');
    }
};
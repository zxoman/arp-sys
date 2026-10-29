<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contracts', function (Blueprint $table) {
            $table->id();
            $table->string('number')->unique();
            $table->foreignId('reservation_id')->nullable()->constrained('reservations')->nullOnDelete();
            $table->string('type'); // sale or rent
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('unit_id')->constrained('units')->cascadeOnDelete();
            $table->date('contract_date');
            $table->decimal('total_price', 14, 2)->unsigned(); // or rent value
            $table->decimal('agreed_down_payment', 14, 2)->unsigned()->default(0);
            $table->unsignedInteger('installments_count')->default(0);
            $table->date('first_installment_date')->nullable();
            $table->unsignedInteger('interval_months')->nullable(); // 1, 3, 12, etc.
            $table->text('notes')->nullable();
            $table->string('status')->default('active'); // active or cancelled
            $table->timestamp('cancelled_at')->nullable();
            $table->text('cancellation_reason')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index('reservation_id');
            $table->index('client_id');
            $table->index('unit_id');
            $table->index('type');
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contracts');
    }
};
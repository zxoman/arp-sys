<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A reservation carries no price: the sale price is agreed only when the reservation is converted
 * to a contract, and a rent value is entered at contract time (BRIEF 2.5).
 *
 * unit_type / unit_activity become nullable because a general (building-level) reservation has no
 * unit to copy them from; the request already treats them as optional.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reservations', function (Blueprint $table) {
            $table->dropColumn('unit_price');
        });

        Schema::table('reservations', function (Blueprint $table) {
            $table->string('unit_type')->nullable()->change();
            $table->string('unit_activity')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('reservations', function (Blueprint $table) {
            // Nullable on the way back: existing rows have no price to restore.
            $table->decimal('unit_price', 14, 2)->unsigned()->nullable()->after('reservation_date');
            $table->string('unit_type')->nullable(false)->change();
            $table->string('unit_activity')->nullable(false)->change();
        });
    }
};

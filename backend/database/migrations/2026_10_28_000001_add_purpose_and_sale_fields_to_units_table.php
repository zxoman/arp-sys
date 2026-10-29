<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Unit purpose (sale / rent / both), the manual "not sellable" flag with its reason, and an explicit
 * sale price that overrides area x price_per_meter.
 *
 * `status` stays automatic (available/reserved/sold/rented) and is NOT replaced by `is_sellable`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('units', function (Blueprint $table) {
            $table->string('purpose', 10)->default('both')->after('activity')->index();
            $table->boolean('is_sellable')->default(true)->after('purpose');
            $table->string('non_sellable_reason', 255)->nullable()->after('is_sellable');
            $table->decimal('sale_price', 14, 2)->unsigned()->nullable()->after('price_per_meter');
        });
    }

    public function down(): void
    {
        Schema::table('units', function (Blueprint $table) {
            $table->dropIndex(['purpose']);
            $table->dropColumn(['purpose', 'is_sellable', 'non_sellable_reason', 'sale_price']);
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Fields the contracts screen needs: the company discount on a sale, the lease terms (rent, term,
 * deposit, advance months, yearly increase) and the free schedule a draft keeps until it is posted.
 *
 * All of them are nullable / defaulted, so existing rows and old API clients keep working.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('contracts', function (Blueprint $table) {
            // Sale: company discount off the list price (total_price is the net price).
            $table->decimal('discount', 14, 2)->unsigned()->default(0)->after('total_price');
            $table->string('discount_reason')->nullable()->after('discount');

            // Lease terms.
            $table->decimal('monthly_rent', 14, 2)->unsigned()->nullable()->after('discount_reason');
            $table->unsignedSmallInteger('duration_months')->nullable()->after('monthly_rent');
            $table->date('start_date')->nullable()->after('duration_months');
            $table->date('end_date')->nullable()->after('start_date');
            $table->decimal('security_deposit', 14, 2)->unsigned()->default(0)->after('end_date');
            $table->unsignedSmallInteger('advance_months')->default(0)->after('security_deposit');
            $table->decimal('annual_increase_pct', 5, 2)->unsigned()->nullable()->after('advance_months');
            $table->unsignedSmallInteger('increase_from_year')->nullable()->after('annual_increase_pct');

            // A draft keeps its schedule here until it is posted (installments are created on posting).
            $table->json('draft_schedule')->nullable()->after('interval_months');
        });
    }

    public function down(): void
    {
        Schema::table('contracts', function (Blueprint $table) {
            $table->dropColumn([
                'discount',
                'discount_reason',
                'monthly_rent',
                'duration_months',
                'start_date',
                'end_date',
                'security_deposit',
                'advance_months',
                'annual_increase_pct',
                'increase_from_year',
                'draft_schedule',
            ]);
        });
    }
};

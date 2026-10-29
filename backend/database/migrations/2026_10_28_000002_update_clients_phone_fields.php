<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Clients: drop the unused `email` column and add an optional second phone (`phone_2`).
 * `phone_2` is normalized exactly like `phone` and is searchable / warning-checked the same way.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->string('phone_2')->nullable()->after('phone');
            $table->index('phone_2');
        });

        Schema::table('clients', function (Blueprint $table) {
            $table->dropColumn('email');
        });
    }

    public function down(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->string('email')->nullable()->after('phone_2');
        });

        Schema::table('clients', function (Blueprint $table) {
            $table->dropIndex(['phone_2']);
            $table->dropColumn('phone_2');
        });
    }
};

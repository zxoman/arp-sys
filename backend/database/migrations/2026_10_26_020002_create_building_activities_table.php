<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('building_activities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('building_id')->constrained('buildings')->cascadeOnDelete();
            $table->string('activity');
            $table->timestamps();

            $table->unique(['building_id', 'activity']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('building_activities');
    }
};

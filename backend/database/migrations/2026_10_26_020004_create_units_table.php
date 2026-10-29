<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('units', function (Blueprint $table) {
            $table->id();
            $table->foreignId('building_id')->constrained('buildings')->cascadeOnDelete();
            $table->foreignId('floor_id')->constrained('floors')->cascadeOnDelete();
            $table->string('name');
            $table->string('type');
            $table->string('activity');
            $table->decimal('area', 14, 2)->unsigned();
            $table->decimal('price_per_meter', 14, 2)->unsigned()->nullable();
            $table->unsignedTinyInteger('rooms')->nullable();
            $table->unsignedTinyInteger('bathrooms')->nullable();
            $table->string('status')->default('available');
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['building_id', 'name']);
            $table->index('floor_id');
            $table->index('type');
            $table->index('activity');
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('units');
    }
};

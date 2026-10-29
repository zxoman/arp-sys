<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('buildings', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('number')->nullable();
            $table->string('type');
            $table->decimal('area', 14, 2)->unsigned()->nullable();
            $table->unsignedInteger('floors_count')->default(0);
            $table->unsignedInteger('units_per_floor')->nullable();
            $table->unsignedInteger('total_units')->default(0);
            $table->boolean('has_basement')->default(false);
            $table->string('city')->nullable();
            $table->string('district')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique('number');
            $table->index('city');
            $table->index('district');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('buildings');
    }
};

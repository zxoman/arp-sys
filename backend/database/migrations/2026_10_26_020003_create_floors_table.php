<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('floors', function (Blueprint $table) {
            $table->id();
            $table->foreignId('building_id')->constrained('buildings')->cascadeOnDelete();
            $table->integer('floor_number'); // 0 = basement, 1..N = above
            $table->string('display_name'); // بدروم, الأول, الثاني, ...
            $table->unsignedInteger('units_count')->default(0);
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['building_id', 'floor_number']);
            $table->index('floor_number');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('floors');
    }
};

<?php

namespace App\Models;

use App\Models\RolePermission;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Role extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'name',
        'display_name',
        'description',
        'is_admin',
        'lock_version',
    ];

    protected $casts = [
        'is_admin' => 'boolean',
        'lock_version' => 'integer',
    ];

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function hasPermission(string $permission): bool
    {
        if ($this->is_admin) {
            return true;
        }

        return RolePermission::where('role_id', $this->id)
            ->where('permission', $permission)
            ->exists();
    }

    public static function adminRole(): ?self
    {
        return self::where('is_admin', true)->whereNull('deleted_at')->first();
    }
}

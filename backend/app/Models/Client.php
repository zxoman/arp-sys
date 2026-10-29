<?php

namespace App\Models;

use App\Support\Text\ArabicNormalizer;
use App\Support\Text\PhoneNormalizer;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Client extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'name',
        'phone',
        'phone_2',
        'national_id',
        'notes',
    ];

    protected static function booted(): void
    {
        static::creating(fn (Client $client) => $client->normalizePhones());
        static::updating(fn (Client $client) => $client->normalizePhones());
    }

    /** Normalizes `phone` / `phone_2` (only the ones that actually changed). */
    private function normalizePhones(): void
    {
        foreach (['phone', 'phone_2'] as $field) {
            if ($this->isDirty($field) && $this->{$field}) {
                $this->{$field} = PhoneNormalizer::normalize($this->{$field});
            }
        }
    }

    public function scopeSearch($query, string $search)
    {
        return $query->where(function ($q) use ($search) {
            $q->where('name', 'like', "%{$search}%")
              ->orWhere('phone', 'like', "%{$search}%")
              ->orWhere('phone_2', 'like', "%{$search}%");
        });
    }

    /** Matches any of the given numbers against either phone column (`phone` / `phone_2`). */
    public function scopeWhereAnyPhone($query, array $phones)
    {
        $phones = array_values(array_filter($phones));

        if ($phones === []) {
            return $query->whereRaw('1 = 0');
        }

        return $query->where(function ($q) use ($phones) {
            foreach ($phones as $phone) {
                $q->orWhere('phone', $phone)->orWhere('phone_2', $phone);
            }
        });
    }

    public function reservations(): HasMany
    {
        return $this->hasMany(Reservation::class);
    }

    public function contracts(): HasMany
    {
        return $this->hasMany(Contract::class);
    }
}
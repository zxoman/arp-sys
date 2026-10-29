<?php

namespace App\Services\Clients;

use App\Enums\AuditAction;
use App\Enums\ReservationStatus;
use App\Models\Client;
use App\Services\Audit\AuditLogger;
use App\Support\Text\PhoneNormalizer;
use App\Support\Transactions\Operation;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ClientService
{
    public function __construct(
        private Operation $operation,
        private AuditLogger $audit
    ) {
    }

    public function create(array $data, $actor): Client
    {
        return DB::transaction(function () use ($data, $actor) {
            // A number another client already has is a WARNING, never a block (BRIEF 2.4).
            $duplicatePhone = $this->findDuplicatePhone([
                $data['phone'] ?? null,
                $data['phone_2'] ?? null,
            ]);

            $client = Client::create([
                'name' => $data['name'],
                'phone' => $data['phone'] ?? null,
                'phone_2' => $data['phone_2'] ?? null,
                'national_id' => $data['national_id'] ?? null,
                'notes' => $data['notes'] ?? null,
            ]);

            if ($duplicatePhone) {
                $this->audit->log(
action: AuditAction::REJECTED_OPERATION->value,
            entityType: 'clients',
            entityId: $client->id,
            newValues: ['name' => $client->name, 'phone' => $client->phone, 'phone_2' => $client->phone_2],
            reason: 'Client created with duplicate phone (warning only). Duplicate client ID: ' . $duplicatePhone->id,
                );
            } else {
                $this->audit->log(
action: AuditAction::CREATE->value,
            entityType: 'clients',
            entityId: $client->id,
            newValues: ['name' => $client->name, 'phone' => $client->phone, 'phone_2' => $client->phone_2],
            reason: 'Client created by ' . $actor->name,
                );
            }

            return $client;
        });
    }

    /** Another client already holding one of this client's numbers (either column); null when clean. */
    public function duplicateOf(Client $client): ?Client
    {
        return $this->findDuplicatePhone([$client->phone, $client->phone_2], $client->id);
    }

    /** First other client with one of these numbers, compared after normalization. */
    private function findDuplicatePhone(array $phones, ?int $exceptClientId = null): ?Client
    {
        $phones = array_values(array_filter(array_map(
            fn ($phone) => $phone ? PhoneNormalizer::normalize($phone) : null,
            $phones,
        )));

        if ($phones === []) {
            return null;
        }

        return Client::whereAnyPhone($phones)
            ->when($exceptClientId, fn ($q) => $q->where('id', '!=', $exceptClientId))
            ->first();
    }

    public function update(Client $client, array $data, $actor): Client
    {
        $oldValues = [
            'name' => $client->name,
            'phone' => $client->phone,
            'phone_2' => $client->phone_2,
        ];

        // Only numbers actually supplied are checked; unchanged ones can't become duplicates.
        $duplicate = $this->findDuplicatePhone([
            $data['phone'] ?? null,
            $data['phone_2'] ?? null,
        ], $client->id);

        $client->update([
            'name' => $data['name'] ?? $client->name,
            'phone' => $data['phone'] ?? $client->phone,
            'phone_2' => $data['phone_2'] ?? $client->phone_2,
            'national_id' => $data['national_id'] ?? $client->national_id,
            'notes' => $data['notes'] ?? $client->notes,
        ]);

        $this->audit->log(
action: AuditAction::UPDATE->value,
            entityType: 'clients',
            entityId: $client->id,
            oldValues: $oldValues,
            newValues: ['name' => $client->name, 'phone' => $client->phone, 'phone_2' => $client->phone_2],
            changedFields: array_keys(array_filter([
                'name' => $data['name'] ?? null,
                'phone' => $data['phone'] ?? null,
                'phone_2' => $data['phone_2'] ?? null,
                'national_id' => $data['national_id'] ?? null,
                'notes' => $data['notes'] ?? null,
            ])),
            reason: $duplicate
                ? 'Client updated with duplicate phone (warning only). Duplicate client ID: ' . $duplicate->id
                : 'Client updated by ' . $actor->name,
        );

        return $client->fresh();
    }

    public function delete(Client $client, $actor): void
    {
        // Soft delete is blocked if the client has an active reservation or any contract at all
        // (BRIEF 2.4) - cancelled items still count as history.
        $hasActiveReservation = $client->reservations()
            ->where('status', ReservationStatus::ACTIVE->value)
            ->exists();

        if ($hasActiveReservation || $client->contracts()->exists()) {
            throw ValidationException::withMessages([
                'client' => __('clients.cannot_delete_with_reservation_or_contract'),
            ]);
        }

        $oldValues = [
            'name' => $client->name,
            'phone' => $client->phone,
        ];

        $client->delete();

        $this->audit->log(
            action: AuditAction::DELETE->value,
            entityType: 'clients',
            entityId: $client->id,
            oldValues: $oldValues,
            reason: 'Client deleted by ' . $actor->name,
        );
    }
}
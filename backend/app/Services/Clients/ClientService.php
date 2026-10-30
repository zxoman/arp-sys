<?php

namespace App\Services\Clients;

use App\Enums\AuditAction;
use App\Models\Client;
use App\Models\Contract;
use App\Models\Reservation;
use App\Services\Audit\AuditLogger;
use App\Services\Units\UnitService;
use App\Services\Units\UnitTreeDeleter;
use App\Support\Text\PhoneNormalizer;
use App\Support\Transactions\Operation;
use Illuminate\Support\Facades\DB;

class ClientService
{
    public function __construct(
        private Operation $operation,
        private AuditLogger $audit,
        private UnitTreeDeleter $deleter,
        private UnitService $units
    ) {}

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
                    reason: 'Client created with duplicate phone (warning only). Duplicate client ID: '.$duplicatePhone->id,
                );
            } else {
                $this->audit->log(
                    action: AuditAction::CREATE->value,
                    entityType: 'clients',
                    entityId: $client->id,
                    newValues: ['name' => $client->name, 'phone' => $client->phone, 'phone_2' => $client->phone_2],
                    reason: 'Client created by '.$actor->name,
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
                ? 'Client updated with duplicate phone (warning only). Duplicate client ID: '.$duplicate->id
                : 'Client updated by '.$actor->name,
        );

        return $client->fresh();
    }

    /**
     * Delete a client for good, together with every deal they own: reservations with their
     * deposits and contracts with their schedule, receipts and payments (owner decision
     * 2026-10-30). Units left with nothing live go back to `available`; units that still have
     * another client's deal keep their status. Returns the removed counts for the API response.
     *
     * @return array<string, int>
     */
    public function delete(Client $client, $actor): array
    {
        return DB::transaction(function () use ($client, $actor) {
            $oldValues = [
                'name' => $client->name,
                'phone' => $client->phone,
                'phone_2' => $client->phone_2,
                'national_id' => $client->national_id,
                'notes' => $client->notes,
            ];

            $contractIds = Contract::withTrashed()->where('client_id', $client->id)->pluck('id');
            $reservationIds = Reservation::withTrashed()->where('client_id', $client->id)->pluck('id');

            // Remember the units before their deals disappear.
            $unitIds = Contract::withTrashed()->whereIn('id', $contractIds)->pluck('unit_id')
                ->merge(Reservation::withTrashed()->whereIn('id', $reservationIds)->pluck('unit_id'))
                ->filter()
                ->unique()
                ->values();

            $deleted = $this->deleter->deleteContracts($contractIds)
                + $this->deleter->deleteReservations($reservationIds);

            $deleted['units_released'] = $this->units->releaseUnits($unitIds, $actor);

            $client->forceDelete();

            $this->audit->log(
                action: AuditAction::DELETE->value,
                entityType: 'clients',
                entityId: $client->id,
                oldValues: $oldValues,
                reason: 'Client deleted with their reservations, contracts and payments by '.$actor->name,
                meta: ['deleted' => $deleted],
            );

            return $deleted;
        });
    }
}

<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\User;
use Tests\TestCase;

class ClientTest extends TestCase
{
    protected function createAdmin(): array
    {
        $user = User::create([
            'name' => 'Admin',
            'username' => 'admin',
            'password' => bcrypt('password123'),
            'status' => 'active',
            'lock_version' => 0,
        ]);

        $role = \App\Models\Role::where('is_admin', true)->first();
        if (!$role) {
            $role = \App\Models\Role::create([
                'name' => 'admin',
                'is_admin' => true,
            ]);
        }
        $user->update(['role_id' => $role->id]);
        $user->refresh();

        $token = $this->getAuthToken($user);

        return ['user' => $user, 'token' => $token];
    }

    protected function getAuthToken(User $user, string $password = 'password123'): string
    {
        $response = $this->postJson('/api/v1/auth/login', [
            'login' => $user->username,
            'password' => $password,
        ]);

        return $response->json('data.token');
    }

    protected function authHeaders(string $token): array
    {
        return ['Authorization' => 'Bearer ' . $token];
    }

    public function test_admin_can_create_client(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/clients', [
                'name' => 'أحمد محمد',
                'phone' => '01012345678',
                'phone_2' => '011 2345 6789',
                'national_id' => '12345678901234',
                'notes' => 'عميل ممتاز',
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('clients', ['name' => 'أحمد محمد']);
        // Phone should be normalized
        $this->assertDatabaseHas('clients', ['phone' => '+201012345678']);
        $this->assertDatabaseHas('clients', ['phone_2' => '+201123456789']);
        // There is no email anymore
        $response->assertJsonMissingPath('data.email');
    }

    public function test_client_email_is_ignored(): void
    {
        $admin = $this->createAdmin();

        $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/clients', [
                'name' => 'بلا بريد',
                'phone' => '01012345678',
                'email' => 'ignored@example.com',
            ])
            ->assertStatus(201)
            ->assertJsonMissingPath('data.email');

        $this->assertArrayNotHasKey('email', Client::first()->getAttributes());
    }

    public function test_admin_can_list_clients(): void
    {
        $admin = $this->createAdmin();

        Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);
        Client::create(['name' => 'Client 2', 'phone' => '+201000000002']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/clients');

        $response->assertStatus(200);
        $response->assertJsonCount(2, 'data');
    }

    public function test_admin_can_update_client(): void
    {
        $admin = $this->createAdmin();

        $client = Client::create(['name' => 'Old Name', 'phone' => '+201000000001']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->putJson('/api/v1/admin/clients/' . $client->id, [
                'name' => 'New Name',
            ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('clients', ['id' => $client->id, 'name' => 'New Name']);
    }

    public function test_admin_can_delete_client(): void
    {
        $admin = $this->createAdmin();

        $client = Client::create(['name' => 'Deletable', 'phone' => '+201000000001']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->deleteJson('/api/v1/admin/clients/' . $client->id);

        $response->assertStatus(200);
        $this->assertSoftDeleted($client);
    }

    public function test_phone_normalization_on_create(): void
    {
        $admin = $this->createAdmin();

        // Test Arabic-Indic digits
        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/clients', [
                'name' => 'Test Client',
                'phone' => '٠١٠١٢٣٤٥٦٧٨',
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('clients', ['phone' => '+201012345678']);
    }

    public function test_phone_normalization_strips_spaces_and_dashes(): void
    {
        $admin = $this->createAdmin();

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/clients', [
                'name' => 'Test Client',
                'phone' => '010-123-4567',
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('clients', ['phone' => '+20101234567']);
    }

    public function test_duplicate_phone_warns_but_does_not_block(): void
    {
        $admin = $this->createAdmin();

        Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/clients', [
                'name' => 'Client 2',
                'phone' => '+201000000001',
            ]);

        $response->assertStatus(201);
        // Should have duplicate_phone meta
        $this->assertTrue($response->json('meta.duplicate_phone'));
        $this->assertDatabaseHas('clients', ['name' => 'Client 2']);
    }

    public function test_client_search_by_name(): void
    {
        $admin = $this->createAdmin();

        Client::create(['name' => 'أحمد محمد علي', 'phone' => '+201000000001']);
        Client::create(['name' => 'سعيد محمود', 'phone' => '+201000000002']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/clients?search=أحمد');

        $response->assertStatus(200);
        $response->assertJsonCount(1, 'data');
        $this->assertEquals('أحمد محمد علي', $response->json('data.0.name'));
    }

    public function test_client_search_by_phone(): void
    {
        $admin = $this->createAdmin();

        Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);
        Client::create(['name' => 'Client 2', 'phone' => '+201000000002']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/clients?search=201000000001');

        $response->assertStatus(200);
        $response->assertJsonCount(1, 'data');
    }

    public function test_clients_index_returns_pagination_meta(): void
    {
        $admin = $this->createAdmin();

        foreach (range(1, 3) as $i) {
            Client::create(['name' => 'Meta Client ' . $i, 'phone' => '+20100000000' . $i]);
        }

        $headers = $this->authHeaders($admin['token']);

        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/clients?per_page=2&sort=id&dir=asc')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.name', 'Meta Client 1')
            ->assertJsonPath('meta.current_page', 1)
            ->assertJsonPath('meta.last_page', 2)
            ->assertJsonPath('meta.per_page', 2)
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('meta.from', 1)
            ->assertJsonPath('meta.to', 2);

        $this->withHeaders($headers)
            ->getJson('/api/v1/admin/clients?per_page=2&page=2&sort=id&dir=asc')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Meta Client 3')
            ->assertJsonPath('meta.current_page', 2)
            ->assertJsonPath('meta.from', 3);
    }

    public function test_client_search_by_second_phone(): void
    {
        $admin = $this->createAdmin();

        Client::create(['name' => 'Client 1', 'phone' => '+201000000001', 'phone_2' => '+201111111111']);
        Client::create(['name' => 'Client 2', 'phone' => '+201000000002', 'phone_2' => '+202222222222']);

        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->getJson('/api/v1/admin/clients?search=201111111111');

        $response->assertStatus(200);
        $response->assertJsonCount(1, 'data');
        $this->assertEquals('Client 1', $response->json('data.0.name'));
    }

    public function test_duplicate_check_covers_the_second_phone(): void
    {
        $admin = $this->createAdmin();

        Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        // The new client's second number matches an existing client's main number.
        $response = $this->withHeaders($this->authHeaders($admin['token']))
            ->postJson('/api/v1/admin/clients', [
                'name' => 'Client 2',
                'phone' => '01099999999',
                'phone_2' => '010 0000 0001',
            ]);

        $response->assertStatus(201);
        $this->assertTrue($response->json('meta.duplicate_phone'));
        $this->assertDatabaseHas('clients', ['name' => 'Client 2', 'phone_2' => '+201000000001']);
    }

    public function test_non_admin_cannot_access_clients(): void
    {
        $user = User::create([
            'name' => 'Regular',
            'username' => 'regular',
            'password' => bcrypt('password123'),
            'status' => 'active',
            'lock_version' => 0,
        ]);

        $token = $this->getAuthToken($user);

        $response = $this->withHeaders($this->authHeaders($token))
            ->getJson('/api/v1/admin/clients');

        $response->assertStatus(403);
    }

    /**
     * Soft delete is blocked while the client has an active reservation or any contract
     * (BRIEF 2.4). A cancelled reservation alone doesn't block.
     */
    public function test_client_delete_is_blocked_by_an_active_reservation(): void
    {
        $admin = $this->createAdmin();

        $client = Client::create(['name' => 'Client 1', 'phone' => '+201000000001']);

        $reservation = \App\Models\Reservation::create([
            'client_id' => $client->id,
            'unit_type' => 'apartment',
            'unit_activity' => 'residential',
            'reservation_date' => now()->toDateString(),
            'status' => 'active',
        ]);

        $headers = $this->authHeaders($admin['token']);

        $this->withHeaders($headers)
            ->deleteJson('/api/v1/admin/clients/' . $client->id)
            ->assertStatus(422)
            ->assertJsonValidationErrors('client');

        $reservation->update(['status' => 'cancelled', 'cancelled_at' => now(), 'cancellation_reason' => 'ملغي']);

        $this->withHeaders($headers)
            ->deleteJson('/api/v1/admin/clients/' . $client->id)
            ->assertStatus(200);

        $this->assertSoftDeleted($client);
    }

    public function test_client_delete_is_blocked_by_a_cancelled_contract(): void
    {
        $admin = $this->createAdmin();

        $building = \App\Models\Building::create([
            'name' => 'Building C',
            'number' => 'C1',
            'type' => 'building',
            'activities' => ['residential'],
            'area' => 1000.00,
            'floors_count' => 1,
        ]);

        $floor = \App\Models\Floor::create([
            'building_id' => $building->id,
            'floor_number' => 1,
            'display_name' => 'الأول',
            'units_count' => 1,
        ]);

        $unit = \App\Models\Unit::create([
            'building_id' => $building->id,
            'floor_id' => $floor->id,
            'name' => 'Unit C1',
            'type' => 'apartment',
            'activity' => 'residential',
            'area' => 100.00,
            'status' => 'available',
        ]);

        $client = Client::create(['name' => 'Client 2', 'phone' => '+201000000002']);

        // Any contract at all blocks the delete, even a cancelled one.
        \App\Models\Contract::create([
            'number' => '2026-9999',
            'type' => 'sale',
            'client_id' => $client->id,
            'unit_id' => $unit->id,
            'contract_date' => now()->toDateString(),
            'total_price' => 500000.00,
            'agreed_down_payment' => 100000.00,
            'installments_count' => 0,
            'status' => 'cancelled',
            'cancelled_at' => now(),
            'cancellation_reason' => 'اختبار',
        ]);

        $this->withHeaders($this->authHeaders($admin['token']))
            ->deleteJson('/api/v1/admin/clients/' . $client->id)
            ->assertStatus(422)
            ->assertJsonValidationErrors('client');

        $this->assertNotSoftDeleted($client);
    }
}
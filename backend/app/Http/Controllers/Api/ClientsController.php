<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Clients\StoreClientRequest;
use App\Http\Requests\Clients\UpdateClientRequest;
use App\Http\Resources\Clients\ClientResource;
use App\Models\Client;
use App\Services\Clients\ClientService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ClientsController extends Controller
{
    public function __construct(private ClientService $clientService) {}

    public function index(): JsonResponse
    {
        $this->authorize('viewAny', Client::class);

        $query = Client::query();

        if ($search = request('search')) {
            $query->search($search);
        }

        $sortable = ['id', 'name', 'phone', 'phone_2', 'national_id', 'created_at'];
        $sort = (string) request('sort', 'created_at');
        $query->orderBy(in_array($sort, $sortable, true) ? $sort : 'created_at', request('dir') === 'asc' ? 'asc' : 'desc');

        $perPage = max(1, min((int) request('per_page', 15), 100));
        $clients = $query->paginate($perPage)->withQueryString();

        return response()->json([
            'data' => ClientResource::collection($clients),
            'meta' => [
                'current_page' => $clients->currentPage(),
                'last_page' => $clients->lastPage(),
                'per_page' => $clients->perPage(),
                'total' => $clients->total(),
                'from' => $clients->firstItem(),
                'to' => $clients->lastItem(),
            ],
        ]);
    }

    public function store(StoreClientRequest $request): JsonResponse
    {
        $client = $this->clientService->create($request->validated(), $request->user());
        $duplicate = $this->clientService->duplicateOf($client);

        return response()->json([
            'data' => new ClientResource($client),
            'meta' => [
                'duplicate_phone' => $duplicate !== null,
                'duplicate_client_id' => $duplicate?->id,
            ],
        ], 201);
    }

    public function show(Client $client): JsonResponse
    {
        $this->authorize('view', $client);

        return response()->json([
            'data' => new ClientResource($client),
        ]);
    }

    public function update(UpdateClientRequest $request, Client $client): JsonResponse
    {
        $this->authorize('update', $client);

        $client = $this->clientService->update($client, $request->validated(), $request->user());
        $duplicate = $this->clientService->duplicateOf($client);

        return response()->json([
            'data' => new ClientResource($client),
            'meta' => [
                'duplicate_phone' => $duplicate ? true : false,
                'duplicate_client_id' => $duplicate?->id,
            ],
        ]);
    }

    public function destroy(Client $client, Request $request): JsonResponse
    {
        $this->authorize('delete', $client);

        $this->clientService->delete($client, $request->user());

        return response()->json([
            'data' => ['message' => __('clients.deleted')],
        ]);
    }
}
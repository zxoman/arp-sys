<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Units\StoreUnitRequest;
use App\Http\Requests\Units\UpdateUnitRequest;
use App\Http\Resources\Units\UnitResource;
use App\Models\Unit;
use App\Services\Units\UnitService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UnitsController extends Controller
{
    public function __construct(private UnitService $unitService) {}

    public function index(): JsonResponse
    {
        $this->authorize('viewAny', Unit::class);

        $query = Unit::query()->with('building', 'floor');

        if ($buildingId = request('building_id')) {
            $query->where('building_id', $buildingId);
        }
        if ($floorId = request('floor_id')) {
            $query->where('floor_id', $floorId);
        }
        if ($type = request('type')) {
            $query->where('type', $type);
        }
        if ($activity = request('activity')) {
            $query->where('activity', $activity);
        }
        if ($status = request('status')) {
            $query->where('status', $status);
        }
        if ($purpose = request('purpose')) {
            $query->where('purpose', $purpose);
        }
        if (request()->has('sellable')) {
            $query->where('is_sellable', filter_var(request('sellable'), FILTER_VALIDATE_BOOLEAN));
        }
        if ($search = trim((string) request('search'))) {
            $query->where('name', 'like', "%{$search}%");
        }

        $sortable = ['id', 'name', 'type', 'activity', 'purpose', 'area', 'price_per_meter', 'sale_price', 'status', 'created_at'];
        $sort = (string) request('sort', 'created_at');
        $query->orderBy(in_array($sort, $sortable, true) ? $sort : 'created_at', request('dir') === 'asc' ? 'asc' : 'desc');

        $perPage = max(1, min((int) request('per_page', 15), 100));
        $units = $query->paginate($perPage)->withQueryString();

        return response()->json([
            'data' => UnitResource::collection($units),
            'meta' => [
                'current_page' => $units->currentPage(),
                'last_page' => $units->lastPage(),
                'per_page' => $units->perPage(),
                'total' => $units->total(),
                'from' => $units->firstItem(),
                'to' => $units->lastItem(),
            ],
        ]);
    }

    public function store(StoreUnitRequest $request): JsonResponse
    {
        $unit = $this->unitService->create($request->validated(), $request->user());

        return response()->json([
            'data' => new UnitResource($unit),
        ], 201);
    }

    public function show(Unit $unit): JsonResponse
    {
        $this->authorize('view', $unit);

        return response()->json([
            'data' => new UnitResource($unit->load('building', 'floor')),
        ]);
    }

    public function update(UpdateUnitRequest $request, Unit $unit): JsonResponse
    {
        $this->authorize('update', $unit);

        $unit = $this->unitService->update($unit, $request->validated(), $request->user());

        return response()->json([
            'data' => new UnitResource($unit),
        ]);
    }

    public function destroy(Unit $unit, Request $request): JsonResponse
    {
        $this->authorize('delete', $unit);

        $this->unitService->delete($unit, $request->user());

        return response()->json([
            'data' => ['message' => __('units.deleted')],
        ]);
    }
}

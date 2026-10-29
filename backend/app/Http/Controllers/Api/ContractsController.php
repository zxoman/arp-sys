<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Contracts\CancelContractRequest;
use App\Http\Requests\Contracts\CancelInstallmentPaymentRequest;
use App\Http\Requests\Contracts\PostContractRequest;
use App\Http\Requests\Contracts\PreviewScheduleRequest;
use App\Http\Requests\Contracts\RecordInstallmentPaymentRequest;
use App\Http\Requests\Contracts\StoreContractRequest;
use App\Http\Resources\Contracts\ContractResource;
use App\Http\Resources\Contracts\InstallmentResource;
use App\Models\Contract;
use App\Models\Installment;
use App\Models\InstallmentPayment;
use App\Policies\ContractPolicy;
use App\Services\Contracts\ContractService;
use App\Services\Contracts\InstallmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ContractsController extends Controller
{
    public function __construct(
        private ContractService $contractService,
        private InstallmentService $installmentService
    ) {}

    public function index(): JsonResponse
    {
        $this->authorize('contracts.view');

        $query = Contract::query();

        if ($status = request('status')) {
            $statuses = explode(',', (string) $status);
            $query->whereIn('status', $statuses);
        }
        if ($clientId = request('client_id')) {
            $query->where('client_id', $clientId);
        }
        if ($buildingId = request('building_id')) {
            $query->whereHas('unit', fn ($q) => $q->where('building_id', $buildingId));
        }
        if ($search = trim((string) request('search'))) {
            // The page searches by contract number, client name, unit name or building name.
            $query->where(function ($q) use ($search) {
                $like = "%{$search}%";
                $q->where('number', 'like', $like)
                    ->orWhereHas('client', fn ($c) => $c->where('name', 'like', $like)->orWhere('phone', 'like', $like))
                    ->orWhereHas('unit', fn ($u) => $u->where('name', 'like', $like)
                        ->orWhereHas('building', fn ($b) => $b->where('name', 'like', $like)));
            });
        }

        $sortable = ['id', 'number', 'type', 'contract_date', 'total_price', 'status', 'created_at'];
        $sort = (string) request('sort', 'created_at');
        $dir = request('dir') === 'asc' ? 'asc' : 'desc';

        // Counts for the type chips, taken before the type filter: the table itself is server-filtered,
        // so the client cannot count the chips from the rows it received.
        $counts = [
            'all' => (clone $query)->count(),
            'sale' => (clone $query)->where('type', 'sale')->count(),
            'rent' => (clone $query)->where('type', 'rent')->count(),
        ];

        if ($type = request('type')) {
            $query->where('type', $type);
        }

        $query
            ->with('client', 'unit.building', 'reservation', 'installments')
            ->withSum(['downPayments as down_payments_sum' => fn ($q) => $q->where('status', 'valid')->whereNull('deleted_at')], 'amount')
            ->withSum(['installmentPayments as installment_payments_sum' => fn ($q) => $q->where('status', 'valid')->whereNull('deleted_at')], 'amount')
            ->orderBy(in_array($sort, $sortable, true) ? $sort : 'created_at', $dir);

        $perPage = max(1, min((int) request('per_page', 15), 100));
        $contracts = $query->paginate($perPage)->withQueryString();

        return response()->json([
            'data' => ContractResource::collection($contracts),
            'meta' => [
                'current_page' => $contracts->currentPage(),
                'last_page' => $contracts->lastPage(),
                'per_page' => $contracts->perPage(),
                'total' => $contracts->total(),
                'from' => $contracts->firstItem(),
                'to' => $contracts->lastItem(),
                'counts' => $counts,
            ],
        ]);
    }

    public function store(StoreContractRequest $request): JsonResponse
    {
        $this->authorize('contracts.create');

        $contract = $this->contractService->create($request->validated(), $request->user());

        return response()->json([
            'data' => new ContractResource($contract),
        ], 201);
    }

    public function show(Contract $contract): JsonResponse
    {
        $this->authorize('contracts.view', $contract);

        return response()->json([
            'data' => new ContractResource($contract->load(
                'client',
                'unit.building',
                'reservation',
                'installments',
                'downPayments',
                'installmentPayments'
            )),
        ]);
    }

    public function postContract(PostContractRequest $request, Contract $contract): JsonResponse
    {
        $this->authorize('contracts.update', $contract);

        $contract = $this->contractService->post($contract, $request->validated(), $request->user());

        return response()->json([
            'data' => new ContractResource($contract),
        ]);
    }

    public function cancel(CancelContractRequest $request, Contract $contract): JsonResponse
    {
        $this->authorize('contracts.cancel', $contract);

        $contract = $this->contractService->cancel(
            $contract,
            $request->validated('cancellation_reason'),
            $request->user()
        );

        return response()->json([
            'data' => new ContractResource($contract),
        ]);
    }

    public function preview(PreviewScheduleRequest $request): JsonResponse
    {
        $this->authorize('contracts.create');

        $preview = $this->installmentService->preview($request->validated());

        return response()->json([
            'data' => $preview,
        ]);
    }

public function recordInstallmentPayment(
    RecordInstallmentPaymentRequest $request,
    Contract $contract,
    Installment $installment
): JsonResponse
{
    $this->authorize('contracts.update', $contract);

    $this->installmentService->recordPayment(
        $contract->id,
        $installment->id,
        $request->validated(),
        $request->user()
    );

    return response()->json([
        'data' => new InstallmentResource($installment->fresh()),
    ], 201);
}

public function cancelInstallmentPayment(
    CancelInstallmentPaymentRequest $request,
    Contract $contract,
    Installment $installment,
    InstallmentPayment $payment
): JsonResponse
{
    $this->authorize('contracts.update', $contract);

    $this->installmentService->cancelPayment(
        $payment,
        $request->validated('cancel_reason'),
        $request->user()
    );

    return response()->json([
        'data' => new InstallmentResource($installment->fresh()),
    ]);
}
}
<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Receipts\CancelReceiptRequest;
use App\Http\Requests\Receipts\StoreReceiptRequest;
use App\Http\Resources\Receipts\ReceiptResource;
use App\Models\Receipt;
use App\Services\Payments\ReceiptService;
use Illuminate\Http\JsonResponse;

/**
 * Receipts (إيصالات القبض): the collection page's list, one numbered receipt covering several
 * installment payments (and optionally the down payment), and cancelling a receipt as a whole.
 */
class ReceiptsController extends Controller
{
    public function __construct(private ReceiptService $receiptService) {}

    public function index(): JsonResponse
    {
        $this->authorize('contracts.view');

        $query = Receipt::query();

        if ($status = request('status')) {
            $query->where('status', $status);
        }
        if ($contractId = request('contract_id')) {
            $query->where('contract_id', $contractId);
        }
        if ($method = request('payment_method')) {
            $query->where('payment_method', $method);
        }
        if ($from = request('from')) {
            $query->whereDate('paid_at', '>=', $from);
        }
        if ($to = request('to')) {
            $query->whereDate('paid_at', '<=', $to);
        }
        if ($clientId = request('client_id')) {
            $query->whereHas('contract', fn ($q) => $q->where('client_id', $clientId));
        }
        if ($search = trim((string) request('search'))) {
            // The page searches by receipt number, contract number, client or unit.
            $query->where(function ($q) use ($search) {
                $like = "%{$search}%";
                $q->where('number', 'like', $like)
                    ->orWhereHas('contract', fn ($c) => $c->where('number', 'like', $like)
                        ->orWhereHas('client', fn ($cl) => $cl->where('name', 'like', $like)->orWhere('phone', 'like', $like))
                        ->orWhereHas('unit', fn ($u) => $u->where('name', 'like', $like)
                            ->orWhereHas('building', fn ($b) => $b->where('name', 'like', $like))));
            });
        }

        $sortable = ['id', 'number', 'paid_at', 'total_amount', 'status', 'created_at'];
        $sort = (string) request('sort', 'paid_at');
        $dir = request('dir') === 'asc' ? 'asc' : 'desc';

        $query
            ->with('contract.client', 'contract.unit.building', 'installmentPayments.installment', 'downPayments', 'createdBy')
            ->orderBy(in_array($sort, $sortable, true) ? $sort : 'paid_at', $dir)
            ->orderBy('id', $dir);

        $perPage = max(1, min((int) request('per_page', 15), 100));
        $receipts = $query->paginate($perPage)->withQueryString();

        return response()->json([
            'data' => ReceiptResource::collection($receipts),
            'meta' => [
                'current_page' => $receipts->currentPage(),
                'last_page' => $receipts->lastPage(),
                'per_page' => $receipts->perPage(),
                'total' => $receipts->total(),
                'from' => $receipts->firstItem(),
                'to' => $receipts->lastItem(),
            ],
        ]);
    }

    public function show(Receipt $receipt): JsonResponse
    {
        $this->authorize('contracts.view');

        return response()->json([
            'data' => new ReceiptResource($receipt->load(
                'contract.client',
                'contract.unit.building',
                'installmentPayments.installment',
                'downPayments',
                'createdBy'
            )),
        ]);
    }

    public function store(StoreReceiptRequest $request): JsonResponse
    {
        $receipt = $this->receiptService->create($request->validated(), $request->user());

        return response()->json([
            'data' => new ReceiptResource($receipt->load('createdBy')),
        ], 201);
    }

    public function cancel(CancelReceiptRequest $request, Receipt $receipt): JsonResponse
    {
        $receipt = $this->receiptService->cancel(
            $receipt,
            $request->validated('cancel_reason'),
            $request->user()
        );

        return response()->json([
            'data' => new ReceiptResource($receipt->load('createdBy')),
        ]);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Reservations\CancelReservationPaymentRequest;
use App\Http\Requests\Reservations\CancelReservationRequest;
use App\Http\Requests\Reservations\CreateReservationPaymentRequest;
use App\Http\Requests\Reservations\StoreReservationRequest;
use App\Http\Resources\Reservations\ReservationPaymentResource;
use App\Http\Resources\Reservations\ReservationResource;
use App\Models\Reservation;
use App\Models\ReservationPayment;
use App\Policies\ReservationPolicy;
use App\Services\Reservations\ReservationPaymentService;
use App\Services\Reservations\ReservationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReservationsController extends Controller
{
    public function __construct(
        private ReservationService $reservationService,
        private ReservationPaymentService $paymentService
    ) {}

    public function index(): JsonResponse
    {
        $this->authorize('viewAny', Reservation::class);

        $query = Reservation::query()->with('client', 'building', 'unit', 'payments');

        if ($status = request('status')) {
            $query->where('status', $status);
        }
        if ($clientId = request('client_id')) {
            $query->where('client_id', $clientId);
        }
        if ($buildingId = request('building_id')) {
            $query->where('building_id', $buildingId);
        }
        if ($search = trim((string) request('search'))) {
            // The page searches by client, unit or building name.
            $query->where(function ($q) use ($search) {
                $q->whereHas('client', fn ($c) => $c->where('name', 'like', "%{$search}%"))
                    ->orWhereHas('unit', fn ($u) => $u->where('name', 'like', "%{$search}%"))
                    ->orWhereHas('building', fn ($b) => $b->where('name', 'like', "%{$search}%"));
            });
        }

        $sortable = ['id', 'reservation_date', 'status', 'created_at'];
        $sort = (string) request('sort', 'created_at');
        $query->orderBy(in_array($sort, $sortable, true) ? $sort : 'created_at', request('dir') === 'asc' ? 'asc' : 'desc');

        $perPage = max(1, min((int) request('per_page', 15), 100));
        $reservations = $query->paginate($perPage)->withQueryString();

        return response()->json([
            'data' => ReservationResource::collection($reservations),
            'meta' => [
                'current_page' => $reservations->currentPage(),
                'last_page' => $reservations->lastPage(),
                'per_page' => $reservations->perPage(),
                'total' => $reservations->total(),
                'from' => $reservations->firstItem(),
                'to' => $reservations->lastItem(),
            ],
        ]);
    }

    public function store(StoreReservationRequest $request): JsonResponse
    {
        $this->authorize('create', Reservation::class);

        $reservation = $this->reservationService->create($request->validated(), $request->user());

        return response()->json([
            'data' => new ReservationResource($reservation),
        ], 201);
    }

    public function show(Reservation $reservation): JsonResponse
    {
        $this->authorize('view', $reservation);

        return response()->json([
            'data' => new ReservationResource($reservation->load('client', 'building', 'unit', 'payments')),
        ]);
    }

    public function cancel(CancelReservationRequest $request, Reservation $reservation): JsonResponse
    {
        $this->authorize('cancel', $reservation);

        $reservation = $this->reservationService->cancel(
            $reservation,
            $request->validated('cancellation_reason'),
            $request->user()
        );

        return response()->json([
            'data' => new ReservationResource($reservation),
        ]);
    }

    public function convert(Reservation $reservation, Request $request): JsonResponse
    {
        $this->authorize('convert', $reservation);

        $data = $this->reservationService->convert($reservation, $request->user());

        return response()->json([
            'data' => $data,
        ]);
    }

    public function payments(Reservation $reservation): JsonResponse
    {
        $this->authorize('view', $reservation);

        return response()->json([
            'data' => ReservationPaymentResource::collection($reservation->payments),
            'meta' => [
                'deposit_paid' => $reservation->deposit_paid,
            ],
        ]);
    }

    public function createPayment(CreateReservationPaymentRequest $request, Reservation $reservation): JsonResponse
    {
        $this->authorize('update', $reservation);

        $payment = $this->paymentService->create(
            $reservation->id,
            $request->validated(),
            $request->user()
        );

        return response()->json([
            'data' => new ReservationPaymentResource($payment),
        ], 201);
    }

    public function cancelPayment(CancelReservationPaymentRequest $request, Reservation $reservation, ReservationPayment $payment): JsonResponse
    {
        $this->authorize('update', $reservation);

        $payment = $this->paymentService->cancel(
            $payment,
            $request->validated('cancel_reason'),
            $request->user()
        );

        return response()->json([
            'data' => new ReservationPaymentResource($payment),
        ]);
    }
}
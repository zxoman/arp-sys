<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

use App\Http\Controllers\Api\Auth\AuthController;
use App\Http\Controllers\Api\Admin\UsersController;
use App\Http\Controllers\Api\Admin\RolesController;
use App\Http\Controllers\Api\Admin\AuditLogsController;
use App\Http\Controllers\Api\Admin\SettingsController;
use App\Http\Controllers\Api\BuildingsController;
use App\Http\Controllers\Api\UnitsController;
use App\Http\Controllers\Api\ClientsController;
use App\Http\Controllers\Api\ReservationsController;
use App\Http\Controllers\Api\ContractsController;
use App\Http\Controllers\Api\CollectionsController;
use App\Http\Controllers\Api\NotificationsController;
use App\Http\Controllers\Api\ReceiptsController;
use App\Http\Controllers\Api\ReportsController;

Route::prefix('v1')->group(function () {
    // Public auth routes
    Route::prefix('auth')->group(function () {
        Route::post('/login', [AuthController::class, 'login'])->middleware('locale');
        Route::post('/logout', [AuthController::class, 'logout'])->middleware(['auth:sanctum', 'locale']);
        Route::get('/me', [AuthController::class, 'me'])->middleware(['auth:sanctum', 'locale']);
        Route::put('/profile', [AuthController::class, 'updateProfile'])->middleware(['auth:sanctum', 'locale']);
        Route::post('/password', [AuthController::class, 'changePassword'])->middleware(['auth:sanctum', 'locale']);
    });

    // Admin routes (require sanctum + permissions)
    Route::middleware(['auth:sanctum', 'locale'])->prefix('admin')->group(function () {
        // Users
        Route::get('/users', [UsersController::class, 'index']);
        Route::post('/users', [UsersController::class, 'store']);
        Route::get('/users/{user}', [UsersController::class, 'show']);
        Route::put('/users/{user}', [UsersController::class, 'update']);
        Route::delete('/users/{user}', [UsersController::class, 'destroy']);
        Route::post('/users/{user}/suspend', [UsersController::class, 'suspend']);
        Route::post('/users/{user}/activate', [UsersController::class, 'activate']);
        Route::post('/users/{user}/reset-password', [UsersController::class, 'resetPassword']);

        // Roles
        Route::get('/roles/permissions', [RolesController::class, 'permissions']);
        Route::get('/roles', [RolesController::class, 'index']);
        Route::post('/roles', [RolesController::class, 'store']);
        Route::get('/roles/{role}', [RolesController::class, 'show']);
        Route::put('/roles/{role}', [RolesController::class, 'update']);
        Route::delete('/roles/{role}', [RolesController::class, 'destroy']);

        // Audit log
        Route::get('/audit-logs', [AuditLogsController::class, 'index']);
        Route::get('/audit-logs/{auditLog}', [AuditLogsController::class, 'show']);

        // Settings (single project data)
        Route::get('/settings', [SettingsController::class, 'show']);
        Route::put('/settings', [SettingsController::class, 'update']);

        // Buildings
        Route::get('/buildings', [BuildingsController::class, 'index']);
        Route::post('/buildings', [BuildingsController::class, 'store']);
        Route::get('/buildings/suggestions', [BuildingsController::class, 'suggestions']);
        Route::get('/buildings/{building}', [BuildingsController::class, 'show']);
        Route::put('/buildings/{building}', [BuildingsController::class, 'update']);
        Route::delete('/buildings/{building}', [BuildingsController::class, 'destroy']);

        // Units
        Route::get('/units', [UnitsController::class, 'index']);
        Route::post('/units', [UnitsController::class, 'store']);
        Route::get('/units/{unit}', [UnitsController::class, 'show']);
        Route::put('/units/{unit}', [UnitsController::class, 'update']);
        Route::delete('/units/{unit}', [UnitsController::class, 'destroy']);

        // Clients
        Route::get('/clients', [ClientsController::class, 'index']);
        Route::post('/clients', [ClientsController::class, 'store']);
        Route::get('/clients/{client}', [ClientsController::class, 'show']);
        Route::put('/clients/{client}', [ClientsController::class, 'update']);
        Route::delete('/clients/{client}', [ClientsController::class, 'destroy']);

        // Reservations
        Route::get('/reservations', [ReservationsController::class, 'index']);
        Route::post('/reservations', [ReservationsController::class, 'store']);
        Route::get('/reservations/{reservation}', [ReservationsController::class, 'show']);
        Route::post('/reservations/{reservation}/cancel', [ReservationsController::class, 'cancel']);
        Route::post('/reservations/{reservation}/convert', [ReservationsController::class, 'convert']);
        Route::get('/reservations/{reservation}/payments', [ReservationsController::class, 'payments']);
        Route::post('/reservations/{reservation}/payments', [ReservationsController::class, 'createPayment']);
        Route::post('/reservations/{reservation}/payments/{payment}/cancel', [ReservationsController::class, 'cancelPayment']);

        // Contracts
        Route::get('/contracts', [ContractsController::class, 'index']);
        Route::post('/contracts', [ContractsController::class, 'store']);
        Route::get('/contracts/{contract}', [ContractsController::class, 'show']);
        Route::post('/contracts/{contract}/cancel', [ContractsController::class, 'cancel']);
        Route::post('/contracts/{contract}/post', [ContractsController::class, 'postContract']);
        Route::post('/contracts/preview-schedule', [ContractsController::class, 'preview']);
        Route::post('/contracts/{contract}/installments/{installment}/payment', [ContractsController::class, 'recordInstallmentPayment']);
        Route::post('/contracts/{contract}/installments/{installment}/payment/{payment}/cancel', [ContractsController::class, 'cancelInstallmentPayment']);

        // Collection (التحصيل) — every installment / down payment across the active contracts
        Route::get('/installments', [CollectionsController::class, 'installments']);
        Route::get('/installments/calendar', [CollectionsController::class, 'installmentCalendar']);
        Route::get('/down-payments', [CollectionsController::class, 'downPayments']);
        Route::get('/down-payments/calendar', [CollectionsController::class, 'downPaymentCalendar']);

        // Header bell — installments and rents that are overdue or due today
        Route::get('/notifications', [NotificationsController::class, 'index']);

        // Receipts (إيصالات القبض) — one receipt may cover several installments and the down payment
        Route::get('/receipts', [ReceiptsController::class, 'index']);
        Route::post('/receipts', [ReceiptsController::class, 'store']);
        Route::get('/receipts/{receipt}', [ReceiptsController::class, 'show']);
        Route::post('/receipts/{receipt}/cancel', [ReceiptsController::class, 'cancel']);

        // Reports
        Route::get('/reports/installments-summary', [ReportsController::class, 'installmentsSummary']);
        Route::get('/reports/due-overdue', [ReportsController::class, 'dueOverdue']);
        Route::get('/reports/customer-statement', [ReportsController::class, 'customerStatement']);
        Route::get('/reports/building-statement', [ReportsController::class, 'buildingStatement']);
        Route::get('/reports/unit-status', [ReportsController::class, 'unitStatus']);
        Route::get('/reports/unit-statement', [ReportsController::class, 'unitStatement']);
        Route::get('/reports/monthly-revenue', [ReportsController::class, 'monthlyRevenue']);
        Route::get('/reports/daily-collection', [ReportsController::class, 'dailyCollection']);
        Route::get('/reports/sales', [ReportsController::class, 'salesReport']);
        Route::get('/reports/daily-inventory', [ReportsController::class, 'dailyInventory']);
        Route::post('/reports/export', [ReportsController::class, 'export']);
    });
});

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Reports\BuildingStatementRequest;
use App\Http\Requests\Reports\CustomerStatementRequest;
use App\Http\Requests\Reports\DailyCollectionRequest;
use App\Http\Requests\Reports\DailyInventoryRequest;
use App\Http\Requests\Reports\MonthlyRevenueRequest;
use App\Http\Requests\Reports\SalesReportRequest;
use App\Http\Requests\Reports\UnitStatementRequest;
use App\Http\Requests\Reports\UnitStatusRequest;
use App\Services\Reports\BuildingStatementService;
use App\Services\Reports\CustomerStatementService;
use App\Services\Reports\DailyCollectionService;
use App\Services\Reports\DailyInventoryService;
use App\Services\Reports\DueOverdueReportService;
use App\Services\Reports\InstallmentsSummaryService;
use App\Services\Reports\MonthlyRevenueService;
use App\Services\Reports\SalesReportService;
use App\Services\Reports\UnitStatementService;
use App\Services\Reports\UnitStatusService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportsController extends Controller
{
    public function __construct(
        protected CustomerStatementService $customerStatement,
        protected BuildingStatementService $buildingStatement,
        protected UnitStatementService $unitStatement,
        protected SalesReportService $salesReport,
        protected InstallmentsSummaryService $installmentsSummary,
        protected DueOverdueReportService $dueOverdue,
        protected DailyInventoryService $dailyInventory,
        protected MonthlyRevenueService $monthlyRevenue,
        protected DailyCollectionService $dailyCollection,
        protected UnitStatusService $unitStatus,
    ) {}

    public function customerStatement(CustomerStatementRequest $request): JsonResponse
    {
        $this->authorize('reports.customer_statement');

        $data = $this->customerStatement->generate(
            (int) $request->validated('client_id'),
            $request->validated('from_date'),
            $request->validated('to_date')
        );

        return response()->json(['data' => $data]);
    }

    public function buildingStatement(BuildingStatementRequest $request): JsonResponse
    {
        $this->authorize('reports.building');

        $data = $this->buildingStatement->generate(
            (int) $request->validated('building_id'),
            $request->validated('from_date'),
            $request->validated('to_date')
        );

        return response()->json(['data' => $data]);
    }

    public function unitStatus(UnitStatusRequest $request): JsonResponse
    {
        $this->authorize('reports.unit');

        $data = $this->unitStatus->generate(array_filter([
            'building_id' => $request->validated('building_id') === null ? null : (int) $request->validated('building_id'),
            'floor_id' => $request->validated('floor_id') === null ? null : (int) $request->validated('floor_id'),
            'type' => $request->validated('type'),
            'purpose' => $request->validated('purpose'),
        ], fn ($value) => $value !== null));

        return response()->json(['data' => $data]);
    }

    public function unitStatement(UnitStatementRequest $request): JsonResponse
    {
        $this->authorize('reports.unit');

        $data = $this->unitStatement->generate(
            (int) $request->validated('unit_id'),
            $request->validated('from_date'),
            $request->validated('to_date')
        );

        return response()->json(['data' => $data]);
    }

    public function monthlyRevenue(MonthlyRevenueRequest $request): JsonResponse
    {
        $this->authorize('reports.sales');

        $data = $this->monthlyRevenue->generate(
            $request->validated('from_date'),
            $request->validated('to_date'),
            $request->validated('building_id') === null ? null : (int) $request->validated('building_id')
        );

        return response()->json(['data' => $data]);
    }

    public function dailyCollection(DailyCollectionRequest $request): JsonResponse
    {
        $this->authorize('reports.daily_inventory');

        $data = $this->dailyCollection->generate(
            $request->validated('from_date'),
            $request->validated('to_date'),
            $request->validated('building_id') === null ? null : (int) $request->validated('building_id')
        );

        return response()->json(['data' => $data]);
    }

    public function salesReport(SalesReportRequest $request): JsonResponse
    {
        $this->authorize('reports.sales');

        $data = $this->salesReport->generate(
            $request->validated('from_date'),
            $request->validated('to_date'),
            $request->only(['building_id', 'unit_type', 'activity', 'contract_type', 'user_id'])
        );

        return response()->json(['data' => $data]);
    }

    /**
     * «ملخص الأقساط والعقود» — one row per non-draft contract with its schedule rollup. The filters
     * are the report's own: contract type, building, client and contract status.
     */
    public function installmentsSummary(Request $request): JsonResponse
    {
        $this->authorize('reports.sales');

        $type = in_array($request->query('type'), ['sale', 'rent'], true) ? $request->query('type') : null;
        $status = in_array($request->query('status'), ['active', 'cancelled'], true) ? $request->query('status') : null;

        return response()->json($this->installmentsSummary->generate(
            $type,
            $request->filled('building_id') ? (int) $request->query('building_id') : null,
            $request->filled('client_id') ? (int) $request->query('client_id') : null,
            $status,
        ));
    }

    /**
     * «الأقساط المستحقة والمتأخرة» — unpaid installments of active contracts that are due today or
     * already late, with the delay buckets. The filters are the report's own: contract type, building,
     * client and one delay bucket.
     */
    public function dueOverdue(Request $request): JsonResponse
    {
        $this->authorize('reports.sales');

        $type = in_array($request->query('type'), ['sale', 'rent'], true) ? $request->query('type') : null;
        $bucket = in_array($request->query('bucket'), DueOverdueReportService::BUCKETS, true) ? $request->query('bucket') : null;

        return response()->json($this->dueOverdue->generate(
            $type,
            $request->filled('building_id') ? (int) $request->query('building_id') : null,
            $request->filled('client_id') ? (int) $request->query('client_id') : null,
            $bucket,
        ));
    }

    public function dailyInventory(DailyInventoryRequest $request): JsonResponse
    {
        $this->authorize('reports.daily_inventory');

        $data = $this->dailyInventory->generate(
            $request->validated('target_date')
        );

        return response()->json(['data' => $data]);
    }

    public function export(DailyInventoryRequest $request): JsonResponse
    {
        $this->authorize('reports.export');

        $reportType = $request->validated('report_type');
        $fromDate = $request->validated('from_date');
        $toDate = $request->validated('to_date');

        // Log the export
        $this->authorize('reports.export');

        return response()->json([
            'data' => [
                'report_type' => $reportType,
                'from_date' => $fromDate,
                'to_date' => $toDate,
                'export_url' => null, // File would be generated and stored
                'message' => 'Export generated (file storage to be implemented)',
            ],
        ]);
    }
}

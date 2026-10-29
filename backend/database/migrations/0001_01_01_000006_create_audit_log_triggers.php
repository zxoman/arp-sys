<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! in_array(DB::getDriverName(), ['mysql', 'mysqli'])) {
            return;
        }

        // Prevent UPDATE on audit_logs (append-only)
        DB::unprepared('
            CREATE TRIGGER audit_logs_no_update
            BEFORE UPDATE ON audit_logs
            FOR EACH ROW
            BEGIN
                SIGNAL SQLSTATE \'45000\'
                SET MESSAGE_TEXT = \'audit_logs is append-only; UPDATE is not allowed\';
            END
        ');

        // Prevent DELETE on audit_logs
        DB::unprepared('
            CREATE TRIGGER audit_logs_no_delete
            BEFORE DELETE ON audit_logs
            FOR EACH ROW
            BEGIN
                SIGNAL SQLSTATE \'45000\'
                SET MESSAGE_TEXT = \'audit_logs is append-only; DELETE is not allowed\';
            END
        ');
    }

    public function down(): void
    {
        if (! in_array(DB::getDriverName(), ['mysql', 'mysqli'])) {
            return;
        }

        DB::unprepared('DROP TRIGGER IF EXISTS audit_logs_no_update');
        DB::unprepared('DROP TRIGGER IF EXISTS audit_logs_no_delete');
    }
};

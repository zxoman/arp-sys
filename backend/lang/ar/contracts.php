<?php

return [
    'created' => 'تم إنشاء العقد بنجاح.',
    'updated' => 'تم تحديث العقد بنجاح.',
    'cancelled' => 'تم إلغاء العقد بنجاح.',
    'reservation_not_found_or_not_active' => 'الحجز غير موجود أو غير نشط.',
    'reservation_has_no_unit' => 'الحجز لا يحتوي على وحدة.',
    'unit_not_found' => 'الوحدة غير موجودة.',
    'unit_not_in_reservation_building' => 'الوحدة ليست في مبنى الحجز.',
    'down_payment_less_than_reservation_payments' => 'المقدم المتفق عليه يجب أن يكون >= مدفوعات الحجز.',
    'down_payment_exceeds_price' => 'المقدم المتفق عليه لا يمكن أن يتجاوز السعر.',
    'start_date_required_for_installments' => 'تاريخ البدء مطلوب عندما يكون عدد الأقساط > 0.',
    'interval_required_for_installments' => 'الفاصل مطلوب عندما يكون عدد الأقساط > 0.',
    'max_installments_exceeded' => 'تجاوز العدد الأقصى للأقساط (360).',
    'unit_has_active_reservation' => 'الوحدة لديها حجز نشط. حوله لعقد بدلًا من ذلك.',
    'cannot_cancel_non_active' => 'لا يمكن إلغاء عقد غير نشط.',
    'cannot_edit_price_below_deposit' => 'لا يمكن تعديل السعر أقل من إجمالي المبالغ المدفوعة.',
    'price_required_for_sale' => 'عقد البيع يحتاج سعرًا (أو جدول أقساط بمبالغ).',
    'rent_total_required' => 'عقد الإيجار يحتاج إجمالي قيمة أو جدول أقساط أو إيجار شهري ومدة.',
    'not_a_draft' => 'هذا العقد ليس مسودة، لا يمكن ترحيله مرة أخرى.',
];
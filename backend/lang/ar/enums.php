<?php

return [
    'user_status' => [
        'active' => 'نشط',
        'suspended' => 'موقوف',
    ],
    'building_type' => [
        'building' => 'عمارة',
        'tower' => 'برج',
        'house' => 'بيت',
        'office_building' => 'مبنى مكاتب',
    ],
    'building_activity' => [
        'residential' => 'سكني',
        'administrative' => 'إداري',
        'commercial' => 'تجاري',
        'medical' => 'طبي',
        'hotel' => 'فندقي',
    ],
    'unit_type' => [
        'apartment' => 'شقة',
        'shop' => 'محل',
        'warehouse' => 'مستودع',
        'studio' => 'استوديو',
    ],
    'unit_status' => [
        'available' => 'متاحة',
        'reserved' => 'محجوزة',
        'sold' => 'مباعة',
        'rented' => 'مؤجرة',
    ],
    'unit_purpose' => [
        'sale' => 'بيع',
        'rent' => 'إيجار',
        'both' => 'بيع وإيجار',
    ],
    'reservation_status' => [
        'active' => 'نشط',
        'converted' => 'محول',
        'cancelled' => 'ملغي',
    ],
    'payment_status' => [
        'valid' => 'صالح',
        'cancelled' => 'ملغي',
    ],
    'payment_method' => [
        'cash' => 'نقدي',
        'bank_transfer' => 'تحويل بنكي',
        'cheque' => 'شيك',
        'vodafone_cash' => 'فودافون كاش',
        'instapay' => 'إنستاباي',
        'other' => 'أخرى',
    ],
    'contract_type' => [
        'sale' => 'بيع',
        'rent' => 'إيجار',
    ],
    'contract_status' => [
        'draft' => 'مسودة',
        'active' => 'نشط',
        'cancelled' => 'ملغي',
    ],
    'installment_status' => [
        'due' => 'مستحق',
        'partially_paid' => 'مدفوع جزئياً',
        'paid' => 'مدفوع',
        'cancelled' => 'ملغي',
    ],
    // Display state on the collection page, recomputed against today (overdue overrides partial).
    'collection_status' => [
        'due' => 'مستحق',
        'overdue' => 'متأخر',
        'partially_paid' => 'جزئي',
        'paid' => 'مدفوع',
    ],
];

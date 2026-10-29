<?php

namespace App\Support\Text;

class PhoneNormalizer
{
    private const DEFAULT_COUNTRY_CODE = '20';

    public static function normalize(string $phone): string
    {
        if ($phone === '') {
            return '';
        }

        // Strip spaces, dashes, parentheses, dots, slash
        $phone = preg_replace('/[\s\-\(\)\.\\/]+/', '', $phone);

        // Convert Arabic-Indic digits to ASCII
        $phone = self::toAsciiDigits($phone);

        // Remove leading plus for processing, then re-add
        $hasPlus = str_starts_with($phone, '+');
        $phone = ltrim($phone, '+');

        // Remove leading zeros
        $phone = ltrim($phone, '0');

        // If starts with country code digits without plus (e.g. 2010xxxxxxxx for Egypt)
        if (str_starts_with($phone, '20') && strlen($phone) > 10) {
            $phone = '+' . $phone;
        } elseif (!$hasPlus && strlen($phone) === 10 && str_starts_with($phone, '1')) {
            // Egyptian mobile: 01xxxxxxxxx -> +201xxxxxxxxx
            $phone = '+' . self::DEFAULT_COUNTRY_CODE . $phone;
        } elseif (!$hasPlus) {
            $phone = '+' . self::DEFAULT_COUNTRY_CODE . $phone;
        }

        return $phone;
    }

    private static function toAsciiDigits(string $text): string
    {
        $arabicIndic = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        $ascii = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

        return str_replace($arabicIndic, $ascii, $text);
    }
}

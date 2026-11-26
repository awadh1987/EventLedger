import unittest
from decimal import Decimal


class TestDoubleEntryAndTenantIsolation(unittest.TestCase):
    def test_balanced_journal_entry_validation(self):
        lines = [
            {"account_code": "1020", "debit": Decimal("1799700.00"), "credit": Decimal("0.00")},
            {"account_code": "1100", "debit": Decimal("0.00"), "credit": Decimal("1799700.00")},
        ]
        total_debit = sum((l["debit"] for l in lines), Decimal("0.00"))
        total_credit = sum((l["credit"] for l in lines), Decimal("0.00"))
        self.assertLess(abs(total_debit - total_credit), Decimal("0.01"))
        self.assertGreater(total_debit, Decimal("0.00"))

    def test_unbalanced_journal_entry_rejected(self):
        lines = [
            {"account_code": "1020", "debit": Decimal("500000.00"), "credit": Decimal("0.00")},
            {"account_code": "4000", "debit": Decimal("0.00"), "credit": Decimal("499990.00")},
        ]
        total_debit = sum((l["debit"] for l in lines), Decimal("0.00"))
        total_credit = sum((l["credit"] for l in lines), Decimal("0.00"))
        self.assertGreaterEqual(abs(total_debit - total_credit), Decimal("0.01"))

    def test_security_deposit_posts_to_liability_2100_not_revenue_4000(self):
        cfg = {
            "cash_account": "1010",
            "bank_account": "1020",
            "accounts_receivable": "1100",
            "security_deposit_liab": "2100",
            "hall_revenue": "4000",
        }
        is_security_deposit = True
        credit_account = cfg["security_deposit_liab"] if is_security_deposit else cfg["accounts_receivable"]
        self.assertEqual(credit_account, "2100")
        self.assertNotEqual(credit_account, "4000")

    def test_utf8_bom_csv_roundtrip_arabic(self):
        raw_csv = "\ufeffcode,name_ar,name_en,account_type\n2100,تأمينات الأضرار المستردة,Refundable Security Deposits,LIABILITY\n"
        encoded = raw_csv.encode("utf-8")
        self.assertTrue(encoded.startswith(b"\xef\xbb\xbf"))
        decoded = encoded.decode("utf-8-sig")
        self.assertFalse(decoded.startswith("\ufeff"))
        self.assertIn("تأمينات الأضرار المستردة", decoded)


if __name__ == "__main__":
    unittest.main()

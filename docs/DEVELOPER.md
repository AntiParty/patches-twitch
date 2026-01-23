# FinalsRS Public Developer API (Beta)

Welcome to the FinalsRS Developer API. We are opening up our data to help the community build amazing tools for THE FINALS.

**Base URL**: `https://finalsrs.com/api/v1`

---

## 🚀 Getting Started

Currently, the API is public and does not require an API key for basic usage. However, we employ IP-based rate limiting.

- **Rate Limit**: 60 requests per minute per IP.
- **CORS**: Enabled for all endpoints.

---

## 🔮 Endpoints

### Get Leaderboard Prediction

Returns the estimated Top 500 cutoff Rank Score (RS) for a future date. This uses our proprietary regression model that accounts for daily trends and end-of-season "rushes".

**Request:**

```http
GET /api/v1/leaderboard/cutoff
```

**Query Parameters:**

| Parameter | Type      | Required | Description                                                                           |
| :-------- | :-------- | :------- | :------------------------------------------------------------------------------------ |
| `days`    | `integer` | No       | Number of days into the future to predict. Defaults to the end of the current season. |

**Response:**

```json
{
  "meta": {
    "generated_at": "2026-01-23T12:00:00.000Z",
    "api_version": "v1",
    "documentation": "https://finalsrs.com/docs/api"
  },
  "data": {
    "current_cutoff_rs": 45100,
    "prediction": {
      "target_date_days": 55,
      "predicted_rs": 62500,
      "confidence_interval": {
        "min": 61200,
        "max": 63800
      },
      "trend": {
        "daily_change": 320,
        "slope_standard_error": 15
      },
      "season_rush": {
        "active": false,
        "multiplier": 1.0
      }
    },
    "confidence_level": "High"
  }
}
```

---

## ⚠️ Terms of Use

1.  **Attribution**: If you use this data in a public project, please credit "FinalsRS" with a link to [finalsrs.com](https://finalsrs.com).
2.  **Caching**: Please cache responses for at least 30 minutes. The underlying data only updates every 45 minutes.
3.  **Abuse**: Excessive scraping or abuse will result in an IP ban.

---

_Verified "Source of Truth" for Season 9 predictions._

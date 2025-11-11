#!/bin/bash
# OPNchain DEX - Fix All Issues Script
# This script applies all necessary fixes automatically

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "╔═══════════════════════════════════════════════════════╗"
echo "║     OPNchain DEX - Automated Fix Script              ║"
echo "║     Applying all fixes...                             ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

FIXES_APPLIED=0
WARNINGS=0

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}✗ Error: package.json not found${NC}"
    echo "  Please run this script from the project root directory"
    exit 1
fi

echo -e "${BLUE}Creating backups...${NC}"
mkdir -p backups/$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"

# Fix 1: tokenHelpers.ts
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Fix #1: tokenHelpers.ts null safety"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f frontend/utils/tokenHelpers.ts ]; then
    # Backup
    cp frontend/utils/tokenHelpers.ts "$BACKUP_DIR/tokenHelpers.ts.backup"
    echo -e "${GREEN}✓${NC} Backed up original file"
    
    # Check if fix is available
    if [ -f outputs/tokenHelpers-fixed.ts ]; then
        cp outputs/tokenHelpers-fixed.ts frontend/utils/tokenHelpers.ts
        echo -e "${GREEN}✓${NC} Applied tokenHelpers.ts fix"
        echo "  - Added null/undefined checks"
        echo "  - Fixed toFixed() errors"
        echo "  - Added NaN and Infinity validation"
        FIXES_APPLIED=$((FIXES_APPLIED+1))
    else
        echo -e "${RED}✗${NC} Fix file not found: outputs/tokenHelpers-fixed.ts"
        WARNINGS=$((WARNINGS+1))
    fi
else
    echo -e "${YELLOW}⚠${NC} File not found: frontend/utils/tokenHelpers.ts"
    WARNINGS=$((WARNINGS+1))
fi

# Fix 2: WOPN Configuration in .env
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Fix #2: WOPN Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f .env ]; then
    cp .env "$BACKUP_DIR/.env.backup"
    echo -e "${GREEN}✓${NC} Backed up .env file"
    
    # Check if WOPN_ADDRESS exists
    if grep -q "WOPN_ADDRESS" .env; then
        WOPN_VALUE=$(grep "WOPN_ADDRESS" .env | cut -d'=' -f2)
        if [ -n "$WOPN_VALUE" ]; then
            echo -e "${GREEN}✓${NC} WOPN_ADDRESS already set: $WOPN_VALUE"
        else
            sed -i.bak 's/WOPN_ADDRESS=.*/WOPN_ADDRESS=0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84/' .env
            echo -e "${GREEN}✓${NC} Updated WOPN_ADDRESS"
            FIXES_APPLIED=$((FIXES_APPLIED+1))
        fi
    else
        echo "" >> .env
        echo "# WOPN Token Configuration" >> .env
        echo "WOPN_ADDRESS=0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84" >> .env
        echo -e "${GREEN}✓${NC} Added WOPN_ADDRESS"
        FIXES_APPLIED=$((FIXES_APPLIED+1))
    fi
    
    # Check if WOPN_PRICE_USD exists
    if ! grep -q "WOPN_PRICE_USD" .env; then
        echo "WOPN_PRICE_USD=0.05" >> .env
        echo -e "${GREEN}✓${NC} Added WOPN_PRICE_USD"
        FIXES_APPLIED=$((FIXES_APPLIED+1))
    else
        echo -e "${GREEN}✓${NC} WOPN_PRICE_USD already set"
    fi
    
    # Check for NEXT_PUBLIC_ vs REACT_APP_
    if grep -q "REACT_APP_API_URL" .env; then
        sed -i.bak 's/REACT_APP_API_URL/NEXT_PUBLIC_API_URL/g' .env
        echo -e "${GREEN}✓${NC} Fixed API_URL prefix (REACT_APP → NEXT_PUBLIC)"
        FIXES_APPLIED=$((FIXES_APPLIED+1))
    fi
    
    if grep -q "REACT_APP_WS_URL" .env; then
        sed -i.bak 's/REACT_APP_WS_URL/NEXT_PUBLIC_WS_URL/g' .env
        echo -e "${GREEN}✓${NC} Fixed WS_URL prefix (REACT_APP → NEXT_PUBLIC)"
        FIXES_APPLIED=$((FIXES_APPLIED+1))
    fi
else
    echo -e "${RED}✗${NC} .env file not found"
    echo "  Creating from template..."
    if [ -f outputs/.env.updated ]; then
        cp outputs/.env.updated .env
        echo -e "${GREEN}✓${NC} Created .env from template"
        FIXES_APPLIED=$((FIXES_APPLIED+1))
    else
        echo -e "${RED}✗${NC} Template not found: outputs/.env.updated"
        WARNINGS=$((WARNINGS+1))
    fi
fi

# Fix 3: WebSocket Server
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Fix #3: WebSocket Server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f backend/websocket/server.ts ]; then
    cp backend/websocket/server.ts "$BACKUP_DIR/server.ts.backup"
    echo -e "${GREEN}✓${NC} Backed up original WebSocket server"
    
    # Check if fix is needed
    if grep -q "data: { channel?: string" backend/websocket/server.ts; then
        echo -e "${GREEN}✓${NC} WebSocket server already has channel support"
    else
        if [ -f outputs/websocket-server-fixed.ts ]; then
            cp outputs/websocket-server-fixed.ts backend/websocket/server.ts
            echo -e "${GREEN}✓${NC} Applied WebSocket server fix"
            echo "  - Added channel-based subscription support"
            echo "  - Fixed 'trades:PAIR' and 'candles:PAIR:TIMEFRAME' formats"
            FIXES_APPLIED=$((FIXES_APPLIED+1))
        else
            echo -e "${RED}✗${NC} Fix file not found: outputs/websocket-server-fixed.ts"
            WARNINGS=$((WARNINGS+1))
        fi
    fi
else
    echo -e "${YELLOW}⚠${NC} File not found: backend/websocket/server.ts"
    WARNINGS=$((WARNINGS+1))
fi

# Fix 4: Frontend Code (REACT_APP to NEXT_PUBLIC)
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Fix #4: Frontend Environment Variables"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

FRONTEND_FILES_CHANGED=0
for file in frontend/pages/index.tsx frontend/components/DexChart.tsx frontend/components/TradeFeed.tsx; do
    if [ -f "$file" ]; then
        if grep -q "REACT_APP_" "$file"; then
            cp "$file" "$BACKUP_DIR/$(basename $file).backup"
            sed -i.bak 's/REACT_APP_API_URL/NEXT_PUBLIC_API_URL/g' "$file"
            sed -i.bak 's/REACT_APP_WS_URL/NEXT_PUBLIC_WS_URL/g' "$file"
            echo -e "${GREEN}✓${NC} Fixed $file"
            FRONTEND_FILES_CHANGED=$((FRONTEND_FILES_CHANGED+1))
        fi
    fi
done

if [ $FRONTEND_FILES_CHANGED -gt 0 ]; then
    echo -e "${GREEN}✓${NC} Updated $FRONTEND_FILES_CHANGED frontend files"
    FIXES_APPLIED=$((FIXES_APPLIED+1))
else
    echo -e "${GREEN}✓${NC} Frontend files already use NEXT_PUBLIC_"
fi

# Check 5: Database
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Check: Database"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v psql >/dev/null 2>&1; then
    if psql -d dex_charts -c "SELECT 1" >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Database 'dex_charts' exists and is accessible"
        
        # Check table count
        TABLE_COUNT=$(psql -d dex_charts -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d ' ')
        if [ "$TABLE_COUNT" -gt 0 ]; then
            echo -e "${GREEN}✓${NC} Database has $TABLE_COUNT tables"
        else
            echo -e "${YELLOW}⚠${NC} Database is empty"
            echo "  Run: psql -d dex_charts -f backend/database/schema.sql"
            WARNINGS=$((WARNINGS+1))
        fi
    else
        echo -e "${YELLOW}⚠${NC} Database 'dex_charts' not found"
        echo "  Run: createdb dex_charts"
        echo "  Then: psql -d dex_charts -f backend/database/schema.sql"
        WARNINGS=$((WARNINGS+1))
    fi
else
    echo -e "${YELLOW}⚠${NC} psql command not found - cannot check database"
    WARNINGS=$((WARNINGS+1))
fi

# Check 6: Redis
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Check: Redis"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v redis-cli >/dev/null 2>&1; then
    if redis-cli ping >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Redis is running"
    else
        echo -e "${YELLOW}⚠${NC} Redis is not running"
        echo "  Start: brew services start redis"
        WARNINGS=$((WARNINGS+1))
    fi
else
    echo -e "${YELLOW}⚠${NC} redis-cli command not found"
    WARNINGS=$((WARNINGS+1))
fi

# Summary
echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║                  SUMMARY                              ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

if [ $FIXES_APPLIED -gt 0 ]; then
    echo -e "${GREEN}✅ Applied $FIXES_APPLIED fix(es) successfully${NC}"
fi

if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠️  $WARNINGS warning(s) - review above${NC}"
fi

echo ""
echo -e "${BLUE}Backups saved to: $BACKUP_DIR${NC}"
echo ""

if [ $FIXES_APPLIED -gt 0 ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📋 Next Steps:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "1. Restart all services (4 terminals):"
    echo "   ${YELLOW}Terminal 1:${NC} yarn dev:indexer"
    echo "   ${YELLOW}Terminal 2:${NC} yarn dev:api"
    echo "   ${YELLOW}Terminal 3:${NC} yarn dev:ws"
    echo "   ${YELLOW}Terminal 4:${NC} cd frontend && yarn dev"
    echo ""
    echo "2. Open browser: ${YELLOW}http://localhost:3001${NC}"
    echo ""
    echo "3. Check browser console (F12) for:"
    echo "   ${GREEN}✓${NC} 'WebSocket connected'"
    echo "   ${GREEN}✓${NC} No 'toFixed' errors"
    echo "   ${GREEN}✓${NC} Pairs loading correctly"
    echo ""
fi

if [ $WARNINGS -gt 0 ]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "⚠️  Review Warnings Above"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    if ! psql -d dex_charts -c "SELECT 1" >/dev/null 2>&1; then
        echo "Database setup needed:"
        echo "  ${YELLOW}createdb dex_charts${NC}"
        echo "  ${YELLOW}psql -d dex_charts -f backend/database/schema.sql${NC}"
        echo ""
    fi
    
    if ! redis-cli ping >/dev/null 2>&1; then
        echo "Redis startup needed:"
        echo "  ${YELLOW}brew services start redis${NC}"
        echo ""
    fi
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📚 Documentation: outputs/COMPLETE_CHECKLIST.md"
echo "🔍 Run diagnostic: ./outputs/diagnose.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎉 Done!"
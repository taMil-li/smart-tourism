# JWT Token Logout Implementation Guide

This guide explains how to properly remove JWT tokens during logout in your web application.

## Overview

JWT tokens are stateless, meaning the server doesn't store them. To "logout" a user, you need to remove the token from the client-side storage and optionally invalidate it on the server.

## Implementation

### 1. Backend Changes

#### New Logout Endpoint (`backend/index.js`)
```javascript
// Logout API - Clear JWT token (client-side logout)
app.post('/api/logout', (req, res) => {
    try {
        // For JWT tokens, we don't need server-side invalidation since they're stateless
        // The client will remove the token from storage
        return res.json({ 
            success: true, 
            message: 'Logged out successfully' 
        });
    } catch (error) {
        console.error('Logout error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
```

### 2. Frontend Changes

#### Token Management Functions (`user_dashboard/script.js`)
```javascript
// Clear JWT token from all storage locations
function clearJWTToken() {
  // Clear JWT token from cookies
  document.cookie = 'jwt=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  // Also clear from localStorage if it exists there
  localStorage.removeItem('jwt');
  localStorage.removeItem('user_data_hash');
  // Clear from sessionStorage as well
  sessionStorage.removeItem('jwt');
  sessionStorage.removeItem('user_data_hash');
}

// Main logout function
function logoutUser() {
  const jwt = getCookie('jwt');
  
  // Call logout API (optional - for logging purposes)
  if (jwt) {
    fetch('http://localhost:3000/api/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': jwt
      }
    }).catch(error => {
      console.log('Logout API call failed:', error);
      // Continue with logout even if API call fails
    });
  }
  
  // Clear all token storage
  clearJWTToken();
  
  // Redirect to login page
  window.location.href = '../authenticate/login.html';
}
```

#### Authentication Check
```javascript
// Check if user is authenticated and redirect if not
async function checkAuthentication() {
  const jwt = getCookie('jwt');
  if (!jwt) {
    console.log('No JWT token found, redirecting to login');
    window.location.href = '../authenticate/login.html';
    return false;
  }

  try {
    const response = await fetch('http://localhost:3000/api/verify-token', {
      method: 'GET',
      headers: { 'authorization': jwt }
    });
    
    const result = await response.json();
    
    if (response.status !== 200 || !result.valid) {
      console.log('Invalid or expired token, redirecting to login');
      clearJWTToken();
      window.location.href = '../authenticate/login.html';
      return false;
    }
    
    console.log('User is authenticated');
    return true;
  } catch (error) {
    console.error('Token verification failed:', error);
    clearJWTToken();
    window.location.href = '../authenticate/login.html';
    return false;
  }
}
```

### 3. UI Integration

#### Logout Buttons (`user_dashboard/index.html`)
```html
<div class="profile-menu" id="profilePopup">
  <a href="#" class="option" id="logoutBtn">Logout</a>
  <a href="#" class="option" id="signOutBtn">Sign Out</a>
</div>
```

#### Event Listeners
```javascript
// Logout button event listener
if (logoutBtn) {
  logoutBtn.addEventListener('click', function(e) {
    e.preventDefault();
    logoutUser();
  });
}

// Sign Out button event listener (for account deactivation)
if (signOutBtn) {
  signOutBtn.addEventListener('click', function(e) {
    e.preventDefault();
    if (confirm('Are you sure you want to sign out? This will deactivate your account.')) {
      signOutUser();
    }
  });
}
```

## How It Works

### 1. **Token Storage Locations**
- **Cookies**: Primary storage method used in your app
- **localStorage**: Backup storage (cleared during logout)
- **sessionStorage**: Session-based storage (cleared during logout)

### 2. **Logout Process**
1. User clicks logout button
2. Frontend calls `/api/logout` endpoint (optional)
3. All token storage locations are cleared
4. User is redirected to login page

### 3. **Authentication Verification**
- On page load, check if JWT token exists
- Verify token with server using `/api/verify-token`
- If invalid/expired, clear tokens and redirect to login

## Security Considerations

### 1. **Token Expiration**
- JWT tokens have built-in expiration (1 hour in your app)
- Expired tokens are automatically rejected by the server

### 2. **Storage Security**
- Cookies are more secure than localStorage (can be httpOnly)
- Consider using httpOnly cookies for production

### 3. **Token Blacklisting** (Optional)
For enhanced security, you can implement token blacklisting:
```javascript
// In your backend, maintain a blacklist of invalidated tokens
const blacklistedTokens = new Set();

app.post('/api/logout', (req, res) => {
    const token = req.headers['authorization'];
    if (token) {
        blacklistedTokens.add(token);
    }
    res.json({ success: true });
});

// In your authentication middleware
function authenticate(req, res, next) {
    const token = req.headers['authorization'];
    if (blacklistedTokens.has(token)) {
        return res.status(401).json({ error: 'Token has been invalidated' });
    }
    // ... rest of authentication logic
}
```

## Usage Examples

### 1. **Simple Logout**
```javascript
// Just clear the token and redirect
function simpleLogout() {
    clearJWTToken();
    window.location.href = '../authenticate/login.html';
}
```

### 2. **Logout with Confirmation**
```javascript
function logoutWithConfirmation() {
    if (confirm('Are you sure you want to logout?')) {
        logoutUser();
    }
}
```

### 3. **Auto-logout on Token Expiry**
```javascript
// Check token validity periodically
setInterval(async () => {
    const isValid = await checkAuthentication();
    if (!isValid) {
        // Token expired, user will be redirected automatically
    }
}, 60000); // Check every minute
```

## Testing

### 1. **Test Logout Functionality**
1. Login to the application
2. Click the logout button
3. Verify you're redirected to login page
4. Try accessing protected pages - should redirect to login

### 2. **Test Token Expiration**
1. Login and note the time
2. Wait for token to expire (1 hour)
3. Try to access protected pages
4. Should be automatically redirected to login

### 3. **Test Multiple Storage Locations**
1. Manually add tokens to localStorage/sessionStorage
2. Perform logout
3. Verify all storage locations are cleared

## Common Issues and Solutions

### 1. **Token Not Cleared**
- Ensure you're clearing from all storage locations
- Check cookie path and domain settings
- Verify the logout function is being called

### 2. **Redirect Not Working**
- Check the redirect URL path
- Ensure the login page exists at the specified location
- Verify there are no JavaScript errors preventing redirect

### 3. **Authentication Check Failing**
- Verify the `/api/verify-token` endpoint is working
- Check network requests in browser dev tools
- Ensure JWT secret is consistent between login and verification

## Best Practices

1. **Always clear tokens from all storage locations**
2. **Implement proper error handling for network requests**
3. **Use secure cookie settings in production**
4. **Consider implementing token refresh for better UX**
5. **Log logout events for security auditing**
6. **Implement proper session timeout handling**

This implementation provides a robust logout system that properly removes JWT tokens and ensures users are securely logged out of your application.

import React, { useState } from 'react';

function App() {
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    bio: '',
    gender: '',
    interests: [],
    country: '',
    newsletter: false,
    terms: false,
  });

  const [submitResult, setSubmitResult] = useState(null);
  const [counter, setCounter] = useState(0);
  const [toggleEnabled, setToggleEnabled] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedOption, setSelectedOption] = useState('');
  const [dynamicContent, setDynamicContent] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (type === 'checkbox' && name === 'interests') {
      setFormData(prev => ({
        ...prev,
        interests: checked
          ? [...prev.interests, value]
          : prev.interests.filter(i => i !== value)
      }));
    } else if (type === 'checkbox') {
      setFormData(prev => ({ ...prev, [name]: checked }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsLoading(true);

    // Simulate API call
    setTimeout(() => {
      setSubmitResult({
        success: true,
        message: 'Form submitted successfully!',
        data: formData
      });
      setIsLoading(false);
    }, 500);
  };

  const handleReset = () => {
    setFormData({
      name: '',
      email: '',
      password: '',
      bio: '',
      gender: '',
      interests: [],
      country: '',
      newsletter: false,
      terms: false,
    });
    setSubmitResult(null);
  };

  const loadDynamicContent = () => {
    setIsLoading(true);
    setTimeout(() => {
      setDynamicContent({
        title: 'Dynamic Content Loaded',
        items: ['Item 1', 'Item 2', 'Item 3']
      });
      setIsLoading(false);
    }, 300);
  };

  return (
    <div className="app">
      <h1 data-testid="page-title">React Test App</h1>
      <p>This app is designed for E2E testing with browser-commander</p>

      {/* Basic Form Section */}
      <section className="section" data-testid="form-section">
        <h2>Contact Form</h2>
        <form onSubmit={handleSubmit} data-testid="contact-form">
          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              placeholder="Enter your name"
              data-testid="input-name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              placeholder="Enter your email"
              data-testid="input-email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleInputChange}
              placeholder="Enter password"
              data-testid="input-password"
            />
          </div>

          <div className="form-group">
            <label htmlFor="bio">Bio / Description</label>
            <textarea
              id="bio"
              name="bio"
              value={formData.bio}
              onChange={handleInputChange}
              placeholder="Tell us about yourself..."
              data-testid="textarea-bio"
            />
          </div>

          <div className="form-group">
            <label>Gender</label>
            <div className="radio-group" data-testid="radio-gender">
              {['male', 'female', 'other'].map(gender => (
                <div className="radio-item" key={gender}>
                  <input
                    type="radio"
                    id={`gender-${gender}`}
                    name="gender"
                    value={gender}
                    checked={formData.gender === gender}
                    onChange={handleInputChange}
                    data-testid={`radio-${gender}`}
                  />
                  <label htmlFor={`gender-${gender}`}>
                    {gender.charAt(0).toUpperCase() + gender.slice(1)}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Interests</label>
            <div className="checkbox-group" data-testid="checkbox-interests">
              {['technology', 'sports', 'music', 'travel', 'food'].map(interest => (
                <div className="checkbox-item" key={interest}>
                  <input
                    type="checkbox"
                    id={`interest-${interest}`}
                    name="interests"
                    value={interest}
                    checked={formData.interests.includes(interest)}
                    onChange={handleInputChange}
                    data-testid={`checkbox-${interest}`}
                  />
                  <label htmlFor={`interest-${interest}`}>
                    {interest.charAt(0).toUpperCase() + interest.slice(1)}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="country">Country</label>
            <select
              id="country"
              name="country"
              value={formData.country}
              onChange={handleInputChange}
              data-testid="select-country"
            >
              <option value="">Select a country</option>
              <option value="us">United States</option>
              <option value="uk">United Kingdom</option>
              <option value="ca">Canada</option>
              <option value="au">Australia</option>
              <option value="de">Germany</option>
            </select>
          </div>

          <div className="form-group">
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="newsletter"
                name="newsletter"
                checked={formData.newsletter}
                onChange={handleInputChange}
                data-testid="checkbox-newsletter"
              />
              <label htmlFor="newsletter">Subscribe to newsletter</label>
            </div>
          </div>

          <div className="form-group">
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="terms"
                name="terms"
                checked={formData.terms}
                onChange={handleInputChange}
                data-testid="checkbox-terms"
              />
              <label htmlFor="terms">I agree to the terms and conditions</label>
            </div>
          </div>

          <div className="button-group">
            <button
              type="submit"
              className="primary"
              disabled={isLoading || !formData.terms}
              data-testid="btn-submit"
            >
              {isLoading ? 'Submitting...' : 'Submit Form'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleReset}
              data-testid="btn-reset"
            >
              Reset
            </button>
          </div>
        </form>

        {submitResult && (
          <div className={`result ${submitResult.success ? 'success' : 'error'}`} data-testid="submit-result">
            <strong>{submitResult.message}</strong>
            <pre>{JSON.stringify(submitResult.data, null, 2)}</pre>
          </div>
        )}
      </section>

      {/* Interactive Elements Section */}
      <section className="section" data-testid="interactive-section">
        <h2>Interactive Elements</h2>

        {/* Counter */}
        <div className="form-group">
          <label>Counter</label>
          <div className="counter">
            <button
              className="secondary"
              onClick={() => setCounter(c => c - 1)}
              data-testid="btn-decrement"
            >
              -
            </button>
            <span className="counter-value" data-testid="counter-value">{counter}</span>
            <button
              className="secondary"
              onClick={() => setCounter(c => c + 1)}
              data-testid="btn-increment"
            >
              +
            </button>
          </div>
        </div>

        {/* Toggle */}
        <div className="form-group">
          <label>Toggle Switch</label>
          <div className="toggle-container">
            <label className="toggle">
              <input
                type="checkbox"
                checked={toggleEnabled}
                onChange={(e) => setToggleEnabled(e.target.checked)}
                data-testid="toggle-switch"
              />
              <span className="toggle-slider"></span>
            </label>
            <span data-testid="toggle-status">
              {toggleEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>

        {/* Dropdown */}
        <div className="form-group">
          <label>Custom Dropdown</label>
          <div className="dropdown">
            <button
              type="button"
              className="secondary"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              data-testid="dropdown-trigger"
            >
              {selectedOption || 'Select an option'} ▼
            </button>
            {dropdownOpen && (
              <div className="dropdown-menu" data-testid="dropdown-menu">
                {['Option A', 'Option B', 'Option C'].map(option => (
                  <button
                    key={option}
                    onClick={() => {
                      setSelectedOption(option);
                      setDropdownOpen(false);
                    }}
                    data-testid={`dropdown-option-${option.toLowerCase().replace(' ', '-')}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedOption && (
            <p data-testid="dropdown-selected">Selected: {selectedOption}</p>
          )}
        </div>

        {/* Modal */}
        <div className="form-group">
          <label>Modal Dialog</label>
          <button
            className="primary"
            onClick={() => setShowModal(true)}
            data-testid="btn-open-modal"
          >
            Open Modal
          </button>
        </div>

        {/* Dynamic Content */}
        <div className="form-group">
          <label>Dynamic Content Loading</label>
          <button
            className="primary"
            onClick={loadDynamicContent}
            disabled={isLoading}
            data-testid="btn-load-content"
          >
            {isLoading ? 'Loading...' : 'Load Content'}
          </button>
          {dynamicContent && (
            <div className="result animated" data-testid="dynamic-content">
              <strong>{dynamicContent.title}</strong>
              <ul>
                {dynamicContent.items.map((item, i) => (
                  <li key={i} data-testid={`dynamic-item-${i}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Scroll Test Section */}
      <section className="section" data-testid="scroll-section">
        <h2>Scroll Test</h2>
        <div className="scroll-test" data-testid="scroll-container">
          {Array.from({ length: 20 }, (_, i) => (
            <div
              key={i}
              className={`scroll-item ${i === 15 ? 'target' : ''}`}
              data-testid={`scroll-item-${i}`}
            >
              {i === 15 ? (
                <>
                  <strong>Target Element</strong>
                  <p>This is the element to scroll to</p>
                  <button
                    className="primary"
                    data-testid="scroll-target-button"
                    onClick={() => alert('Target clicked!')}
                  >
                    Click Me
                  </button>
                </>
              ) : (
                <>Item {i + 1}</>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Navigation Section */}
      <section className="section" data-testid="navigation-section">
        <h2>Navigation Test</h2>
        <div className="button-group">
          <a href="/page-1" data-testid="link-page-1">Go to Page 1</a>
          <a href="/page-2" data-testid="link-page-2">Go to Page 2</a>
          <button
            className="primary"
            onClick={() => window.location.href = '/success'}
            data-testid="btn-navigate"
          >
            Navigate to Success
          </button>
        </div>
      </section>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" data-testid="modal-overlay">
          <div className="modal" data-testid="modal">
            <h3>Modal Title</h3>
            <p>This is modal content. You can close it or confirm.</p>
            <input
              type="text"
              placeholder="Enter something..."
              data-testid="modal-input"
            />
            <div className="modal-buttons">
              <button
                className="secondary"
                onClick={() => setShowModal(false)}
                data-testid="modal-cancel"
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => {
                  alert('Confirmed!');
                  setShowModal(false);
                }}
                data-testid="modal-confirm"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
